var wrench = require("wrench");
var path = require("path");
var fs = require("fs");
var csv = require("csv");
var async = require("async");
var temp = require("temp");

// var request = require("request").defaults({'proxy':'http://localhost:55137'})
var request = require("request");

temp.track();

module.exports = function() {

    var r = {};

    /**
     * Reads a JSON file from disk.
     *
     * @type {Function}
     */
    var readJsonObject = r.readJsonObject = function(filePath)
    {
        var text = fs.readFileSync(filePath, "utf8");

        return JSON.parse("" + text);
    };

    /**
     * Finds files within a given directory that have a given name.
     *
     * @param dirPath
     * @param name
     * @returns {Array}
     */
    var findFiles = r.findFiles = function(dirPath, name)
    {
        var paths = [];

        var allFiles = wrench.readdirSyncRecursive(dirPath);
        for (var i = 0; i < allFiles.length; i++)
        {
            var filename = path.basename(allFiles[i]);
            if (filename === name)
            {
                var fullPath = path.join(dirPath, allFiles[i]);

                paths.push(fullPath);
            }
        }

        return paths;
    };

    /**
     * Strips a key from a JSON object and hands back the value.
     *
     * @type {Function}
     */
    var strip = r.strip = function(json, key)
    {
        var x = json[key];
        delete json[key];

        return x;
    };

    var loadCsvFromGoogleDocs = r.loadCsvFromGoogleDocs = function(key, callback)
    {
        // var url = "https://docs.google.com/spreadsheets/d/" + key + "/export?format=csv&id=" + key + "&gid=0";
        var url = "https://docs.google.com/a/cloudcms.com/spreadsheets/d/" + key + "/export?format=csv&id=" + key;
        console.log("  -> " + url);
        request(url, function (error, response, body) {

            if (error) {
                console.log("ERROR WHILE REQUESTING GOOGLE DOC: " + url);
                process.exit();
                return callback(error);
            }

            if (response.statusCode === 404) {
                console.log("Heard 404: " + url);
                process.exit();
                return callback();
            }

            if (response.statusCode == 200) {
                return callback(null, "" + body);
            }

            console.log("HEARD: " + response.statusCode + " for URL: " + url);
            process.exit();

            callback({
                "code": response.statusCode
            });
        });
    };

    var buildObjectFromCsv = r.buildObjectFromCsv = function(csvText, keyColumnIndex, valueColumnIndex, callback)
    {
        csv.parse(csvText, function(err, data) {

            var obj = {};

            if (data.length > 0)
            {
                for (var i = 1; i < data.length; i++)
                {
                    var key = data[i][keyColumnIndex];
                    var value = data[i][valueColumnIndex];

                    obj[key] = value;
                }
            }

            callback(null, obj);
        });
    };

    var buildObjectFromCsvData = r.buildObjectFromCsvData = function(csvData, keyColumnIndex, valueColumnIndex)
    {
        var obj = {};

        if (csvData && csvData.length > 0)
        {
            for (var i = 1; i < csvData.length; i++)
            {
                var key = csvData[i][keyColumnIndex];
                var value = csvData[i][valueColumnIndex];

                obj[key] = value;
            }
        }

        return obj;
    };

    var loadCsvFile = r.loadCsvFile = function(csvPath, callback)
    {
        var csvText = fs.readFileSync(csvPath, {encoding: "utf8"});
        csv.parse(csvText, {
            relax: true,
            delimiter: ';'
        }, function(err, data) {
            callback(err, data);
        });
    };

    var parseCsv = r.parseCsv = function(csvText, callback)
    {
        csv.parse(csvText, {
            relax: true
        }, function(err, data) {
            callback(err, data);
        });
    };

    var csv2text = r.csv2text = function(csvData, callback)
    {
        csv.stringify(csvData, {
            //quote: '"',
            //quoted: true,
            escape: '\\'
        }, function(err, csvText) {
            callback(err, csvText);
        });
    };

    return r;

}();
