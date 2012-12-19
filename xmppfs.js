var Path = require('path');
var extend = require('extend');
var moment = require('moment');
var xmpp = require('node-xmpp');
var f4js = require('fuse4js');

var fs = require('./fs');
var util = require('./util');
var Presence = require('./feature/presence').Presence;
var Version = require('./feature/version').Version;
var Router = require('./feature/router').Router;
var Roster = require('./feature/roster').Roster;
var Disco = require('./feature/disco').Disco;
var VCard = require('./feature/vcard').VCard;
var Ping = require('./feature/ping').Ping;
var model = require('./lib/model');
var view = require('./lib/view');

var defaults = {
    status: "hello world",
    password: "secret",
    resource: "fs",
    priority: "0",
    show: "chat",
};

var options = {
    mount:"/tmp/mnt/user@domain",
    dir:  "/tmp/mnt",
//     debug: true,
};

// -----------------------------------------------------------------------------

var accounts = {}
var connections = 0;
var root = new fs.Directory({photos:new fs.Directory()});
root.children.photos.hidden = true;
root.mkdir = function (name, mode, callback) {
    var jid = new xmpp.JID(name);
    var barejid = jid.bare().toString();
    fs.Directory.prototype.mkdir.call(root, barejid, mode, function (err) {
        if (err === fs.E.OK && !accounts[barejid]) {
            var attrs = extend({}, defaults);
            var onclose;
            accounts[barejid] = new model.Account(
              jid, attrs, options, root.children[barejid])
                .on('client', function (client)  {
                    console.error("client",client.jid.toString())
                    if (onclose)
                        process.removeListener('close connection', onclose);
                    else connections++;
                    onclose=function(){if(client.connection.socket)client.end()};
                    process.on('close connection', onclose);
                }).on('client closed', function () {
                    console.error("client closed")
                    if (!onclose) return;
                    connections--;
                    process.removeListener('close connection', onclose);
                    process.emit('connection closed');
                    onclose = null;
                }).on('photo', function (name, node) {
                    root.children.photos.add(name, node);
                });
            }
        callback(err);
    });
};

var skipumount = true;
function unmount(callback) {
    if (skipumount) return callback();
    console.log("unmount.");
    var cmd = "fusermount -u " + options.mount;
    require('child_process').exec(cmd, function (err) {
        if (err) console.error(""+err);
        callback();
    });
}



function main() {
    if (process.argv.length < 3) {
        console.log("Usage: %s mount jid", Path.basename(process.argv[1]));
        return process.exit(-1);
    }
    if (process.argv.length > 2)  options.dir = process.argv[2];
    options.mount = Path.normalize(options.dir);

    var closing = false;

    options.destroy = function() {
        if (closing) return;
        closing = true;
        process.emit('close connection'); // close all connections
        if (!connections) process.emit('connection closed');
    };
    process.on('SIGINT', function () {
        skipumount = false;
        options.destroy();
    });
    process.on('connection closed', function () {
        if (!connections && closing) unmount(function() { process.exit(0); });
    });

    var contacttree = {
        ":user@:domain": {  '/':view.contact,
            ":resource": { '/':view.resource,
            },
        },
    };
    var contactstree = {
        "contacts": { '/':view.contacts,
            ":group": extend({'/':view.group}, contacttree),
        },
    };
    var routes = {
        '/':view.root,
        ":jid": extend({ '/':view.account,
            "roster": extend({'/':view.roster}, contacttree),
        }, contactstree, contacttree),
    };

    try {
        f4js.start(options.mount,fs.createRouter(root,routes,options),options.debug);
    } catch (err) {
        console.log("Exception when starting file system: " + err);
    }
}

main();