var Gitana = require("gitana");
var fs = require("fs");
var path = require("path");
var mime = require('mime-types')
var async = require("async");
var cli_args = require('command-line-args');
var util = require("./lib/util");
var csv2markdown = require("./lib/csv2markdown");

var cli = cli_args([
    {name: 'help', alias: 'h', type: Boolean},
    {name: 'list-types', alias: 'l', type: Boolean, description: 'list local type definitions'},
    {name: 'type-name', alias: 't', type: String, description: '_qname of the type definition to import'},
    {name: 'csv-path', alias: 'c', type: String, description: 'path to content csv file to import'},
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

if(options["list-types"])
{
    for(var type in typeDefinitions) {
        // console.log(JSON.stringify(typeDefinitions[type]));
        console.log(" _qname: " + typeDefinitions[type].json._qname + " Title: " + typeDefinitions[type].json.title);
    }
    return;
}

var importType = typeDefinitions[options["type-name"]];
if(!importType)
{
    console.log("No type found with _qname \"" + options["type-name"] + "\"");
    return;
}
console.log("Importing " + importType.json._qname);

var gitanaConfig = JSON.parse("" + fs.readFileSync("../gitana.json"));
Gitana.connect(gitanaConfig, function(err) {
    var node;

    if (err) {
        console.log("Failed to connect: " + JSON.stringify(err));
        return;
    }

    var self = this;

    self.datastore("content").trap(function(err) {
        console.log(err);
        return false;
    }).readBranch(branchId).then(function () {
        var branch = this;

        this.queryNodes({
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

});

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
