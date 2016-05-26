var Gitana = require("gitana");
var fs = require("fs");
var path = require("path");
var mime = require('mime-types')
var async = require("async");
var cli_args = require('command-line-args');
var util = require("./lib/util");

var cli = cli_args([
    {name: 'help', alias: 'h', type: Boolean},
    {name: 'list-types', alias: 'l', type: Boolean, description: 'list local type definitions'},
    {name: 'type-name', alias: 't', type: String, description: '_qname of the type definition to import'},
    {name: 'csv-path', alias: 'c', type: String, description: 'path to content csv file to import'},
    {name: 'property-name', alias: 'p', type: String, description: 'name of an extra property to set ex.: -p contentType"'},
    {name: 'property-value', alias: 'v', type: String, description: 'value of the extra property ex.: -v article"'},
    {name: 'replace', alias: 'r', type: Boolean, description: 'replace type definitions if found'},
    {name: 'branch', alias: 'b', type: String, description: 'branch to write content to. branch id or "master". Default is "master"'}
]);

var TYPES_PATH = "./docs/types";

var options = cli.parse()
if(options.help || (!options["csv-path"] && !options["type-name"] && !options["list-types"]))
{
    console.log(cli.getUsage(options));
    return;
}

var branchId = options["branch"] || "master";
var csvPath = options["csv-path"];
var typeDefinitions = listTypeDefinitions();
var importTypeName = options["type-name"];
var importType = typeDefinitions[importTypeName];
var propertyName = options["property-name"];
var propertyValue = options["property-value"];

var gitanaConfig = JSON.parse("" + fs.readFileSync("../gitana.json"));

if (csvPath && importType) {
    var nodes = [];
    var headers = [];
    var csvContent = util.loadCsvFile(csvPath, function(err, data){
        if (err) {
            console.log("error loading csv " + err);
            return;
        }

        if (data.length < 2) {
            console.log("array too small. 1st row should be header row");
            return;
        }

        for(var i = 0; i < data[0].length; i++) {
            headers.push(data[0][i]);
        }

        for(var i = 1; i < data.length; i++) {
            var node = {};
            node["_type"] = importTypeName;
            
            if (propertyName) {
                node[propertyName] = propertyValue;
            }
            
            for(var j = 0; j < headers.length; j++) {
                node[headers[j]] = data[i][j];
            }

            // console.log("adding node: " + JSON.stringify(node));
            nodes.push(node);
        }
        // console.log(JSON.stringify(nodes));
        console.log("creating nodes. count: " + nodes.length);
        
        // connect and import content
        util.getBranch(gitanaConfig, branchId, function(err, branch) {
            // branch.queryNodes({
            //     "_type": "ers:article"
            // },
            // {
            //     "limit": 5
            // }).each(function() {
            //     console.log("found node: " + JSON.stringify(this));
            // });

            // branch.createNode(nodes[0]).trap(function(err){
            //     return callback(err);
            // }).then(function(){
            //     if(!this || !this._doc)
            //     {
            //         return callback("Node not created");
            //     }

                // console.log("created a node: " + JSON.parse(JSON.stringify(nodes[0])));

                // util.createNodesInTransaction(Gitana, branch, nodes, function(err) {
                //     if (err) {
                //         console.log("error loading csv " + err);
                //     }
                //     return;
                // });

            // });
            
            var transaction = Gitana.transactions().create(branch);

            for(var i = 0; i < nodes.length; i++) {
                console.log("Adding create node call to transaction: " + nodes[i].slug);
                transaction.create(nodes[i]);
            }

            console.log("Commit nodes. Count: " + nodes.length);

            // commit
            transaction.commit().then(function(results) {
                console.log("transaction complete: " + JSON.stringify(results));
                console.log("Created nodes. Count: " + results.successCount);
            });
            
            // util.createNodesInTransaction(Gitana, branch, nodes, function(err) {
            //     if (err) {
            //         console.log("error loading csv " + err);
            //     }
            //     return;
            // });
        });
        
    });
}
else if(options["list-types"])
{
    for(var type in typeDefinitions) {
        // console.log(JSON.stringify(typeDefinitions[type]));
        console.log(" _qname: " + typeDefinitions[type].json._qname + " Title: " + typeDefinitions[type].json.title);
    }
    return;
}
else if(!importType)
{
    console.log("No type found with _qname \"" + options["type-name"] + "\"");
    return;
}
else if (importType)
{
    console.log("Importing " + importType.json._qname);
    
    util.getBranch(gitanaConfig, branchId, function(err, branch) {
        branch.queryNodes({
            "_type": importType.json._type,
            "_qname": importType.json._qname
        }).count(function(c) {
            if(c>0) {
                console.log("Can't import. Node already exists: " + importType.json.id);
                return;
            }

            // console.log(JSON.stringify(this));
            node = this;
            console.log("Node not found. Creating...");

            async.waterfall([
                async.apply(createContext, importType, branch),
                writeNode,
                uploadAttachments
            ], function (err, context) {
                if(err)
                {
                    console.log("Error creating node " + err);
                }
                else {
                    console.log("Node has been imported succesfully");
                }
                return;
            });
            return;
        });
    });
}
else
{
    console.log(cli.getUsage(options));
    return;    
}

function writeNode(context, callback) {
    context.branch.createNode(context.node).trap(function(err){
        return callback(err);
    }).then(function(){
        if(!this || !this._doc)
        {
            return callback("Node not created");
        }

        // console.log("Created node " + JSON.stringify(this));
        console.log("Created node " + this._doc);
        context.node = this;
        callback(null, context);
    });
}

function uploadAttachments(context, callback) {
    if(!context.attachments || context.attachments.length === 0)
    {
        // skipping, no attachments
        return callback(null, context);
    }

    if(!context.node)
    {
        return callback("Node not found");
    }

    async.each(context.attachments, function(attachment, callback){
        console.log("adding attachment " + attachment.attachmentId);

        context.node.attach(
            attachment.attachmentId,
            mime.lookup(attachment.path),
            fs.readFileSync(attachment.path),
            path.basename(attachment.path))
        .trap(function(err){
            return callback("Attachment upload failed " + err);
        }).then(function(){
            console.log("Attachment upload complete");
            callback(null, context);
        });
    }, function(err){
        return callback(err, context);
    });
}

function listTypeDefinitions() {
    var types = {};
    var files = util.findFiles(TYPES_PATH, "node.json");
    for (var i = 0; i < files.length; i++)
    {
        // module directory
        var dir = path.dirname(files[i]);
        var name = path.basename(files[i]);

        // read the module.json file
        var json = util.readJsonObject(files[i]);

        types[json._qname] = {
            "json": json,
            "dir": dir
        };
    }

    return types;
}

function createContext(node, branch, done) {
    var context = {
        "attachments": [],
        "branch": branch,
        "node": node.json
    };

    var nodeDir = node.dir;

    // attachments
    var attachmentsDir = path.join(nodeDir, "attachments");
    if (fs.existsSync(attachmentsDir))
    {
        var attachmentFiles = fs.readdirSync(attachmentsDir);
        for (var p = 0; p < attachmentFiles.length; p++)
        {
            var attachmentId = attachmentFiles[p];
            if (attachmentId.indexOf(".") > -1) {
                attachmentId = attachmentId.substring(0, attachmentId.indexOf("."));
            }

            context.attachments.push({
                // "_doc": product._alias,
                "attachmentId": attachmentId,
                "path": path.resolve(path.join(attachmentsDir, attachmentFiles[p]))
            });
        }
    }

    return done(null, context);
};
