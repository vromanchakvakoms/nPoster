'use strict';
var Promise = require('bluebird');
var Twit = require('twit');
var mongojs = require('mongojs');
var fs = require("fs");
var http = require('http');

var pmongo = require('promised-mongo');

var collections = ['ok', ''];
var db = pmongo('localhost/poster', collections);



var tmpDir = './tmp/';


var twit = new Twit({
    consumer_key: '',
    consumer_secret: '',
    access_token: '',
    access_token_secret: ''
})


var dbQuery = {
    /* attachments: {
     $exists: true
     }, */
    posted_to_twitter: {
        $exists: false
    },
    //"attachments.link": {$exists: true},
    "attachments.photo": {
        $exists: true //true for photo
    },
    $and: [
        {
            $where: "this.text.length <= 140" //116 for photo
        },

        //{
        //    $where: "this.attachments.length  >= 1"
        //},
        //{
        //    $where: "this.attachments.length  <= 4"
        //}
    ],

}


Promise.coroutine(function* () {

    let item = yield getDbRecord();

    let mediaArr = yield downloadMedia(item)
        .then(uploadMedia);

     postToTwitter(item[0].text, mediaArr)
         .then(function(res){
             console.log('Send!:',res)
         })
        .catch(function (err) {
            console.log('Shiiit, not send:',err);
        });
})();







function getDbRecord() {
    return db.ok.find(dbQuery)
        .limit(1)
        .sort({date: 1}).toArray();
}


function downloadMedia(item) {
    return new Promise(function (resolve, reject) {
        //console.log(item[0]);
        //console.log(item[0].attachments);
        var attachments = item[0].attachments;
        if (attachments === undefined)
            return resolve([]);

        var count = 0,
            photoArr = [];

        promiseFor(function (count) {
                return count < attachments.length;
            },
            function (count) {
                return _downloadMedia(attachments[count])
                    .then(function (res) {
                        photoArr.push(res);
                        return ++count;
                    }).catch(function (err) {
                        console.log(err);
                    });
            },
            0)
            .then(resolve.bind(resolve, photoArr))
            .catch(function (err) {
                console.log('Download Media Error', err);
                reject(err);
            });
    });
}


function uploadMedia(filenameArr) {
    return new Promise(function (resolve, reject) {
        //console.log(filenameArr);

        if (filenameArr.length === 0)
            return resolve([]);

        var count = 0;
        var mediaIdArr = [];

        promiseFor(function (count) {
                return count < filenameArr.length;
            }, function (count) {
                return _uploadToTwitter(filenameArr[count])
                    .then(function (res) {
                        mediaIdArr.push(res);
                        return ++count;
                    }).catch(function (err) {
                        console.log('twi upload failed', err);
                    })
            },
            0)
            .then(resolve.bind(resolve, mediaIdArr));

    });

}

function postToTwitter(status, mediaIdArr) {
    return new Promise(function (resolve, reject) {

        //console.log(status);
        //console.log(mediaIdArr);

        let postObject = {
            status: status,
            media_ids: mediaIdArr
        };

        if (status === undefined)
            return reject('status is undefined');

        if (mediaIdArr.length === 0)
            delete postObject.media_ids;

        twit.post('statuses/update',
            postObject,
            function (err, data, response) {
                if (err) {
                    console.log(err);
                    reject(err);
                }
                resolve(data.text);
            })

    });
}


var _getBiggestSizePhotoUrl = function (attachmentPhotoObject) {

    function strpos(haystack, needle, offset) {
        var i = (haystack + '').indexOf(needle, (offset || 0));
        return i === -1 ? false : i;
    }

    var photosizes = [];
    var biggestSizePhoto;

    for (var k in attachmentPhotoObject) {
        if (strpos(k, "photo_") === 0) {
            //to get SIZE, URL ARRAY [ 807, 'http://cs317718.vk.me/v317718170/23bb/-WJTxwOIA6o.jpg' ]
            photosizes.push([parseInt(k.replace(/[^\d.]/g, '')), attachmentPhotoObject[k]]);
        }
    }

    //get maximum size url
    biggestSizePhoto = photosizes.reduce(function (p, v) {
        return (p[0] > v[0] ? p : v);
    });

    //we dont need width so just return URL
    return biggestSizePhoto[1];

};


var promiseFor = Promise.method(function (condition, action, value) {
    if (!condition(value)) return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

function _downloadMedia(attachment) {
    return new Promise(function (resolve, reject) {

        if (attachment.type !== 'photo')
            return reject('not a photo');


        var fileUrl = _getBiggestSizePhotoUrl(attachment.photo);
        var fileName = fileUrl.split('/').pop();

        try {
            var file = fs.createWriteStream(tmpDir + fileName);

            var request = http.get(fileUrl, function (response) {
                response.pipe(file);

                file.on('finish', function () {
                    file.close(resolve(fileName)); // close() is async, resolve after close completes.

                });

            }).on('error', function (err) {
                console.log('File write error:', err);
                fs.unlink(tmpDir + fileName,reject(err)); // Delete the file async. (But we don't check the result)
            });


        } catch (err) {
            console.log(err);
            reject(err);
        }

    });
}


function _uploadToTwitter(filename) {
    return new Promise(function (resolve, reject) {

        var b64content = fs.readFileSync(tmpDir + filename, {
            encoding: 'base64'
        });
        twit.post('media/upload', {
            media_data: b64content
        }, function (err, data, response) {

            if (err) {
                console.log('Upload to Twitter error:', err);
                reject(err);
            }

            fs.unlink(tmpDir + filename);

            resolve(data.media_id_string);
        });
    });
}


