var Gitana = require("gitana");
var fs = require("fs");
var path = require("path");
var mime = require('mime-types')
var async = require("async");
var cli_args = require('command-line-args');
var camel = require('camel-case');
var sanitizeHtml = require('sanitize-html');
var md = require('to-markdown');
var marked = require('marked');

var util = require("./lib/util");

// debug only when using charles proxy ssl proxy when intercepting cloudcms api calls:
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var options = cli_args([
    {name: 'help', alias: 'h', type: Boolean},
    {name: 'list-types', alias: 'l', type: Boolean, description: 'list local type definitions'},
    {name: 'type-name', alias: 't', type: String, description: '_qname of the type definition to import'},
    {name: 'csv-path', alias: 'c', type: String, description: 'path to content csv file to import'},
    {name: 'xml-path', alias: 'x', type: String, description: 'path to content xml file to import'},
    {name: 'category', type: String, description: 'name of category to associate to. ex.: --category "Respiratory World Wide"'},
    {name: 'property-name', alias: 'p', type: String, multiple: true, description: 'name of an extra property to set ex.: -p contentType"'},
    {name: 'property-value', alias: 'v', type: String, multiple: true, description: 'value of the extra property ex.: -v article"'},
    {name: 'replace', alias: 'r', type: Boolean, description: 'replace type definitions if found'},
    {name: 'branch', alias: 'b', type: String, description: 'branch to write content to. branch id or "master". Default is "master"'},
    {name: 'simulate', alias: 's', type: Boolean, description: 'don\'t actually send anything to cloud cms'},
]);

var TYPES_PATH = "./docs/types";
var TYPE_QNAME__CATEGORY = "ers:category";

// var options = cli.parse()
if(options.help || (!options["csv-path"] && !options["type-name"] && !options["list-types"]))
{
    console.log(cli.getUsage(options));
    return;
}

var branchId = options["branch"] || "master";
var csvPath = options["csv-path"];
var xmlPath = options["xml-path"];
var typeDefinitions = listTypeDefinitions();
var importTypeName = options["type-name"];
var importType = typeDefinitions[importTypeName];
var propertyNames = options["property-name"];
var propertyValues = options["property-value"];
var simulate = options["simulate"] || false;
var category = options["category"];

var homeDirectory = function()
{
    return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
};

var rootCredentials = JSON.parse("" + fs.readFileSync(path.join(homeDirectory(), ".cloudcms", "credentials.json")));

var gitanaConfig = JSON.parse("" + fs.readFileSync("../gitana.json"));
gitanaConfig.username = rootCredentials.username;
gitanaConfig.password = rootCredentials.password;

if (csvPath && importType) {
    // import list of nodes from rows of a csv file
    var nodes = [];
    var headers = [];
    util.loadCsvFile(csvPath, function(err, data){
        // import records from a CSV file directly into Cloud CMS
        
        if (err) {
            console.log("error loading csv " + err);
            return;
        }

        if (data.length < 2) {
            console.log("array too small. 1st row should be header row");
            return;
        }

        // prepare node list from csv records
        
        // expect the first row to define header names. use these as property names
        var bodyIndex = -1;
        for(var i = 0; i < data[0].length; i++) {
            if (data[0][i] === "text")
            {
                // "text" field becomes "body" in the new content model
                headers.push("body");
                bodyIndex = i;
            }
            else
            {
                headers.push(camel(data[0][i]));
            }
        }

        for(var i = 1; i < data.length; i++) {
            var node = newArticleNode(importTypeName, {
                "importSource": csvPath
            });

            if (propertyNames) {
                for(var j = 0; j < propertyNames.length; j++) {
                    node[propertyNames[j]] = propertyValues[j] || "";
                }
            }
            
            for(var j = 0; j < headers.length; j++) {
                if (j === bodyIndex)
                {
                    // clean up the body field before import
                    node[headers[j]] = cleanText(data[i][j]);;
                    // node[headers[j]] = md(data[i][j]);
                }
                else
                {
                    node[headers[j]] = data[i][j];
                }
            }

            // console.log("adding node: " + JSON.stringify(node));
            nodes.push(node);
        }
        // console.log(JSON.stringify(nodes));
        console.log("creating nodes. count: " + nodes.length);
        
        if (!simulate)
        {
            // connect and import content
            util.getBranch(gitanaConfig, branchId, function(err, branch) {

                // util.createNodesInTransaction(Gitana, branch, nodes, function(err) {
                util.createNodes(branch, nodes, function(err) {
                    if (err) {
                        console.log("error creating nodes: " + err);
                    }
                    return;
                });
            });
            
        }
    });
}
else if (xmlPath && importType)
{
    // import list of nodes from records in an xml file
    var nodes = [];
    var headers = [];
    util.parseXMLFile(xmlPath, function(err, data){
        if (err) {
            console.log("error loading xml " + err);
            return;
        }

// console.log("data: \n" + JSON.stringify(data));
        if (Gitana.isArray(data.export.items))
        {
            data = data.export.items[0].item
        }
        else
        {
            data = data.export.items.item
        }
        
        for(var i = 1; i < data.length; i++) {
            var node = newArticleNode(importTypeName, {
                "title": data[i].name,
                "slug": data[i].id,
                "id": data[i].id,
                "importSource": xmlPath
            });
            
            if (propertyNames) {
                for(var j = 0; j < propertyNames.length; j++) {
                    node[propertyNames[j]] = propertyValues[j] || "";
                }
            }
            
            if (data[i].data.text && data[i].data.text.name == "Subtitle")
            {
                node.subTitle = data[i].data.text.value;
            }

            if (data[i].data.text && data[i].data.textarea)
            {
                if (data[i].data.textarea[0])
                {
                    // first textarea is the leadParagraph

                    // node.leadParagraph = md(sanitizeHtml(data[i].data.textarea[0].value));
                    // node.leadParagraph = md(data[i].data.textarea[0].value);
                    node.leadParagraph = cleanText(data[i].data.textarea[0].value);
                }

                if (data[i].data.textarea[1])
                {
                    // second textarea is the body

                    // node.body = md(sanitizeHtml(data[i].data.textarea[1].value));
                    // node.body = md(data[i].data.textarea[1].value);
                    node.body = cleanText(data[i].data.textarea[1].value);
                    // node.originalImageURL = extractImagePath(node.body) || "";
                }

                if (data[i].data.image)
                {
                    // grab image path
                    for(var j = 0; j < data[i].data.image.length; j++)
                    {
                        if (data[i].data.image[j] && data[i].data.image[j].name === "Image")
                        {
                            node.originalImageURL = data[i].data.image[j].file || "";
                        }
                    }
                }
            }

            // console.log("adding node: " + JSON.stringify(node));
            console.log("adding node: " + JSON.stringify(node.id));
            nodes.push(node);
        }

        // console.log(JSON.stringify(nodes));
        if (nodes.length==0)
        {
            console.log("No nodes found to import");
            return;
        }

        console.log("creating nodes. count: " + nodes.length);
        
        if (!simulate)
        {
            // connect and import content
            util.getBranch(gitanaConfig, branchId, function(err, branch) {
                if (err) {
                    console.log("error connecting to Cloud CMS: " + JSON.stringify(err));
                    return;
                }

                // if there was a category then find or create the category node
                if (category)
                {
                    var categoryNode = null;
                    branch.subchain(branch).then(function() {
                        branch.queryOne({
                            "_type": TYPE_QNAME__CATEGORY,
                            "title": category
                        }).trap(function(err) {
                            console.log("Could not create category node: " + category + ". err: " + JSON.stringify(err));
                        }).then(function() {
                            var categoryNode = this;
                            if (categoryNode)
                            {
                                for(var i = 0; i < nodes.length; i++)
                                {
                                    nodes[i]["category"] = referenceFromNode(categoryNode);
                                }

                                // util.createNodesInTransaction(Gitana, branch, nodes, function(err) {
                                util.createNodes(branch, nodes, function(err) {
                                    if (err) {
                                        console.log("error creating nodes: " + err);
                                    }
                                    return;
                                });
                            }
                            else
                            {
                                // create category
                                branch.subchain(branch).then(function() {
                                    branch.createNode(newCatNode(TYPE_QNAME__CATEGORY, {"title": category}))
                                    .trap(function(err) {
                                        console.log("Could not create category node: " + category + ". err: " + JSON.stringify(err));
                                    }).then(function(categoryNode) {
                                        for(var i = 0; i < nodes.length; i++)
                                        {
                                            nodes[i]["category"] = referenceFromNode(categoryNode);
                                        }

                                        // util.createNodesInTransaction(Gitana, branch, nodes, function(err) {
                                        util.createNodes(branch, nodes, function(err) {
                                            if (err) {
                                                console.log("error creating nodes: " + err);
                                            }
                                            return;
                                        });
                                    });
                                });
                            }
                        });
                    });
                }
                else
                {
                    // util.createNodesInTransaction(Gitana, branch, nodes, function(err) {
                    util.createNodes(branch, nodes, function(err) {
                        if (err) {
                            console.log("error creating nodes: " + err);
                        }
                        return;
                    });
                }
            });
        }        
    });
}
else if (options["list-types"])
{
    // print a list of definition type qnames in folder: docs/types
    for(var type in typeDefinitions) {
        // console.log(JSON.stringify(typeDefinitions[type]));
        console.log(" _qname: " + typeDefinitions[type].json._qname + " Title: " + typeDefinitions[type].json.title);
    }
    return;
}
else if (importType)
{
    // import a definition from a node.json file in docs/types identified by it's _qname property (NOT IT'S FILE NAME!)
    console.log("Importing " + importType.json._qname);

    if (!simulate)
    {
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
}
else
{
    if (!importType)
    {
        console.log("No type found with _qname \"" + options["type-name"] + "\"");
        return;
    }

    console.log(cli.getUsage(options));
    return;    
}

function referenceFromNode(node) {
    return {
        "id": node._doc,
        "reference": "node://" + [
            node.getBranch().getPlatformId(),
            node.getBranch().getRepositoryId(),
            node.getBranch().getId(),
            node._doc,
        ].join('/')
    }
}

function cleanText(text) {
    var newText = md(sanitizeHtml(text));
    
    return newText;
}

function extractImagePath(markdownText) {
    var renderer = new marked.Renderer();

    renderer.image = function (href, title, text) {
        console.log(marked('# heading+', { renderer: renderer }));
        return "";
    };

    console.log(marked(markdownText, { renderer: renderer }));
}

function newArticleNode(typeName, defaults) {
    var node = {
        "_type": typeName,
        "title": "",
        "slug": "",
        "id": "",
        "subTitle": "",
        "leadParagraph": "",
        "body": "",
        "originalImageURL": "",
        "imported": true
    };
    
    if (defaults)
    {
        for(var key in defaults) {
            node[key] = defaults[key];
        }
    }
    
    return node;
}

function newCatNode(typeName, defaults) {
    var node = {
        "_type": typeName,
        "title": "",
        "slug": "",
        "id": "",
        "body": "",
        "originalImageURL": "",
        "imported": true
    };
    
    for(var key in defaults) {
        node[key] = defaults[key];
    }
    
    return node;
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
