var Gitana = require("gitana");
var wrench = require("wrench");
var path = require("path");
var fs = require("fs");
var csv = require("csv");
var async = require("async");
var xml2js = require('xml2js');
var xml2jsProcessors = require('xml2js/lib/processors');

var request = require("request");

module.exports = function() {

    var r = {};

    var refFromNode = r.refFromNode = function(node)
    {
        return {
            "id": node._doc,
            "ref": "node://" + [
                node.getBranch().getPlatformId(),
                node.getBranch().getRepositoryId(),
                node.getBranch().getId(),
                node._doc,
            ].join('/')
            // "title": node.title,
            // "qname": node._qname,
            // "typeQName": node._type
        }
    };

    /**
     * connect to Cloud CMS and retrieve branch
     * 
     */
    var getBranch = r.getBranch = function(gitanaConfig, branchId, callback)
    {
        Gitana.connect(gitanaConfig, function(err) {
            if (err) {
                console.log("Failed to connect: " + JSON.stringify(err));
                return callback(err);
            }

            this.datastore("content").trap(function(err) {
                console.log("Failed to retrieve datastore: " + JSON.stringify(err));
                return callback(err);

            }).readBranch(branchId || "master").trap(function(err) {
                console.log("Failed to retrieve branch: " + JSON.stringify(err));
                return callback(err);

            }).then(function () {
                console.log("Connected: " + JSON.stringify(this));
                return callback(null, this);
            })
        });
    };
    
    var findOrCreateNode = r.findOrCreateNode = function(branch, query, json, callback) {
        var node = null;
        Chain(branch).queryNodes(query).trap(function(err) {
            return callback(err);
        }).keepOne().then(function() {
            node = this;
            console.log(".then() " + JSON.stringify(node));

            if(!node || !node._doc)
            {
                branch.subchain(branch).createNode(json).trap(function(err){
                    return callback(err);
                }).then(function(){
                    node = this;
                    
                    if(!node || !node._doc)
                    {
                        return callback("Node not created");
                    }

                    // console.log("Created node " + JSON.stringify(this));
                    console.log("Created node " + node._doc);
                    return callback(null, node);
                });
            }
            else
            {
                return callback(null, node);
            }
        });
    }

    var deleteNodes = r.deleteNodes = function(branch, deleteQuery, callback)
    {
        console.log("Deleting nodes " + JSON.stringify(deleteQuery));

        branch.subchain(branch).then(function() {
            var nodes = [];
            branch.queryNodes(deleteQuery, {"limit": 500}).each(function(){
                nodes.push(this._doc);
            }).then(function() {
                if (nodes.length === 0)
                {
                    return callback();
                }

                branch.subchain(branch).deleteNodes(nodes).then(function(){
                    callback();
                })
            })            
        });
    }

    var createNodes = r.createNodes = function(branch, nodes, callback)
    {
        // console.log("Creating node " + JSON.stringify(nodes[0]));

        branch.subchain(branch).then(function() {
            for(var i = 0; i < nodes.length; i++)
            {
                branch.createNode(nodes[i]);
            }
            
            callback();
        });
    }
    
    var createNodesInTransaction = r.createNodesInTransaction = function(_Gitana, branch, nodes, callback)
    {
        var transaction = _Gitana.transactions().create(branch);

        for(var i = 0; i < nodes.length; i++) {
            console.log("Adding create node call to transaction: " + nodes[i].id);
            transaction.create(nodes[i]);
        }

        console.log("Commit nodes. Count: " + nodes.length);

        // commit
        transaction.commit().then(function(results) {
            console.log("transaction complete: " + JSON.stringify(results));
            console.log("Created nodes. Count: " + results.successCount);
            console.log("Failed nodes. Count: " + results.errorCount);
            if (results.errorCount>0) {
                return callback(JSON.stringify(results));
            }
            else
            {
                return;
            }
        });
    };
    /**
     * Parse an XML file and return an object representation.
     */
    var parseXMLFile = r.parseXMLFile = function(inputXMLfilePath, callback)
    {
        console.log("parsing xml from " + inputXMLfilePath);

        var xml2jsParser = new xml2js.Parser({
            "trim": true,
            "normalize": true,
            "ignoreAttrs": false,
            "explicitArray": false,
            "mergeAttrs": true,
            "preserveChildrenOrder": true,
            "normalizeTags": true,
            "async": true
        });

        fs.readFile(inputXMLfilePath, 'utf8', function(err, data) {
            xml2jsParser.parseString(data, function (err, result) {
                if(err)
                {
                    return callback(err);
                }

                return callback(null, result);
            });
        });
    }

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
