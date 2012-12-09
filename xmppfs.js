var Path = require('path');
var moment = require('moment');
var xmpp = require('node-xmpp');
var f4js = require('fuse4js');

var fs = require('./fs');
var Presence = require('./feature/presence').Presence;
var Router = require('./feature/router').Router;
var Roster = require('./feature/roster').Roster;
var Disco = require('./feature/disco').Disco;
var VCard = require('./feature/vcard').VCard;
var Ping = require('./feature/ping').Ping;

var options = {
    mount:"/tmp/mnt/user@domain",
    dir:  "/tmp/mnt",
//     debug: true,
};

// -----------------------------------------------------------------------------

function formatDate(date) {
    return "[" + moment(date).format("hh:mm:ss") + "]";
}

function escapeResource(resource) {
    return ("" + resource).replace("/", "_");
}

function openChat(node, from) {
    var name = from.bare().toString();
    if (node.chats[name]) {
        return node.chats[name].openChat(escapeResource(from.resource));
    }
    var open = function (resource) {
        var chat = new fs.Directory(resource, {
            messages: new fs.File("messages"),
            presence: new fs.File("presence"),
        });
        chat.parent = jid;
        jid.children[resource] = chat;
        chat.children.presence.setMode("r--r--r--");
        chat.children.messages._offset = 0;
        chat.children.messages._new = "";
        var old_read = chat.children.messages.read;
        chat.children.messages.read = function (offset, len, buf, fd, callback) {
            this._offset = this.content.length;
            this._new = "";
            return old_read.call(this, offset, len, buf, fd, callback);
        };
        chat.children.messages.write = function (offset, len, buf, fd, callback) {
            if (!node.client) return callback(fs.E.OK);
            var to = new xmpp.JID(name);
            if (this._offset + this._new.length === offset)
                this.content.write(this._new + formatDate() + "< " + buf.toString('utf8') + "\n");
            else {
                this.content.write(buf.slice(0,this._offset).toString('utf8')
                    + this._new + formatDate() + "< "
                    + buf.slice(this._offset).toString('utf8')
                    + "\n");
            }
            to.setResource(resource === "undefined" ? undefined : resource);
            node.client.send(new xmpp.Element('message', {to:to, type:'chat'})
                .c('body').t(buf.slice(this._offset + this._new.length - offset).toString('utf8'))
            );
            this._offset = 0;
            this._new = "";
            callback(len);
        };
        return chat;
    }
    var jid = new fs.Directory(name);
    node.children[name] = jid;
    node.chats[name] = jid;
    jid.openChat = open;
    jid.parent = node;
    jid.mkdir = function (resource, mode, callback) {
        open(resource);
        callback(fs.E.OK);
    };
    return open(escapeResource(from.resource));
}

function getChat(node, stanza) {
    var chat, from = new xmpp.JID(stanza.attrs.from);
    if (!(chat = node.chats[from.bare().toString()]))
        chat = openChat(node, from);
    else if (!(chat = chat.children[escapeResource(from.resource)]))
        chat = openChat(node, from);
    return chat;
}

var connections = 0;
var root = new fs.Directory("");
root.mkdir = function (name, mode, callback) {
    var jid = new xmpp.JID(name);
    console.log("create new jid " + jid);
    var node = new fs.Directory(jid.bare().toString(), {
        roster:   new fs.Directory("roster"),
        password: new fs.File("password", "secret"),
        resource: new fs.File("resource", jid.resource),
        state:    new fs.State("state", ["online", "offline"], "offline"),
        status:   new fs.File("status", "dodo is using this for tests"),
        priority: new fs.File("priority", "0"),
        show:     new fs.File("show", "chat"),
        iqs:      new fs.File("iq"),
    });
    node.chats = {};
    node.jid = jid;
    node.parent = this;
    this.children[name] = node;
    node.mkdir = function (from, mode, callback) {
        var chat = getChat(node.children.roster, {attrs:{from:from}});
        if (chat.parent && !node.chats[chat.parent.name]) {
            node.children[chat.parent.name] = chat.parent;
            node.chats[chat.parent.name] = chat.parent;
        }
        callback(fs.E.OK);
    };
    node.readdir = function (callback) {
        callback(fs.E.OK, Object.keys(this.children).map(function (name) {
            if (name === "roster" && this.children[name].hidden)
                    name = "." + name;
            return name;
        }.bind(this)));
    };
    node.children.roster.chats = {};
    node.children.roster.hidden = true;
    node.children.state.on('state', function (state) {
        if (state === "offline") {
            if (node.client) {
                console.log("disconnect client %s …", node.jid.toString());
                node.client.end();
                delete node.client;
            }
            return;
        }
        if (node.client) return;
        node.jid.setResource(node.children.resource.content.toString('utf8'));
        console.log("connect client %s …", node.jid.toString());
        var client = node.client = new xmpp.Client({jid:node.jid,
            password:node.children.password.content.toString('utf8')});
        node.children.password.setMode("r--r--r--");
        node.children.roster.client = client;
        client.router = new Router(client);
        client.router.on('error', console.error.bind(console));
        var onclose = function () {client.end()};
        process.on('close connection', onclose);
        connections++;
        client.router.f = {};
        client.router.f.disco    = new Disco( client.router);
        client.router.f.vcard    = new VCard( client.router);
        client.router.f.presence = new Presence(client.router);
        client.router.f.roster   = new Roster(client.router, client.router.f.disco);
        client.router.f.ping     = new Ping(  client.router, client.router.f.disco);
        client.on('stanza', client.router.onstanza);

        client.on('online', function  () {
            console.log("client %s online.", node.jid.toString());
            node.children.roster.hidden = false;
            node.children.resource.content.reset();
            node.children.resource.setMode("r--r--r--");
            node.children.resource.content.write("" + node.jid.resource);
            client.router.f.presence.send({
                priority: node.children.priority.content.toString('utf8'),
                status: node.children.status.content.toString('utf8'),
                show: node.children.show.content.toString('utf8'),
                from: client.jid,
            });
            client.router.f.roster.get(function (err, stanza, items) {
                if (err) return console.error("roster:",err);
                items.forEach(function (item) {
                    console.log(item.attrs);
                    var isnew = !node.children.roster.children[
                        (new xmpp.JID(item.attrs.jid)).bare().toString()];
                    var chat = getChat(node.children.roster,
                                       {attrs:{from:item.attrs.jid}});
                    if (isnew) chat.parent.hidden = true;
                    if (!chat.children.subscription) {
                        var f = new fs.State("subscription",
                            ["from", "to", "both"],
                            item.attrs.subscription);
                        chat.children.subscription = f;
                        f.parent = chat;
                        client.router.f.presence.send({
                            type:'probe', from:client.jid, to:item.attrs.jid});
                    }
                    chat.children.subscription.setState(item.attrs.subscription);
                });
            });
        });
        client.on('close', function () {
            node.children.roster.hidden = true;
            node.children.resource.setMode("rw-rw-rw-");
            node.children.password.setMode("rw-rw-rw-");
            console.log("client %s offline.", node.jid.toString());
            process.removeListener('close connection', onclose);
            node.client = null;
            connections--;
            process.emit('connection closed');
        });
        client.router.match("self::message", function (stanza) {
            var chat = getChat(node.children.roster, stanza);
            if (chat.parent && !node.chats[chat.parent.name]) {
                node.children[chat.parent.name] = chat.parent;
                node.chats[chat.parent.name] = chat.parent;
            }
            var message = stanza.getChildText('body');
            if (message) {
                chat.children.messages.content.write(formatDate() + "> " + message + "\n");
                chat.children.messages._new = chat.children.messages.content
                    .buffer.slice(chat.children.messages._offset).toString('utf8');
            }
        });
        client.router.on('presence', function (stanza) {
            var chat = getChat(node.children.roster, stanza);
            if (chat.parent && !node.chats[chat.parent.name]) {
                node.children[chat.parent.name] = chat.parent;
                node.chats[chat.parent.name] = chat.parent;
            }
            chat.parent.hidden = !!stanza.attrs.type;
            chat.children.presence.content.write(stanza.toString() + "\n");
            ;["show","status","priority"].forEach(function (name) { var text;
                if ((text = stanza.getChildText(name))) {
                    if (!chat.children[name]) {
                        var f = new fs.File(name, text);
                        chat.children[name] = f;
                        f.setMode("r--r--r--");
                        f.parent = chat;
                    }
                    chat.children[name].content.reset();
                    chat.children[name].content.write(text);
                }
            });
            var s; if ((s = stanza.getChild("x", VCard.NS.update)) && s.getChildText("photo")) {
                client.router.f.vcard.get(stanza.attrs.from, function (err, stanza, match) {
                    if (err) return console.error("fetch errored:", err);
                    for (var text, i = 0; i < match.length ; i++) {
                        if (match[i].name === "PHOTO" &&
                           (text = match[i].getChildText("BINVAL"))) {
                            var blob = new Buffer(text, 'base64');
                            if (!chat.children.avatar) {
                                var f = new fs.File("avatar", blob);
                                chat.children.avatar = f;
                                f.setMode("r--r--r--");
                                f.parent = chat;
                            }
                            chat.children.avatar.content.reset();
                            chat.children.avatar.content.write(blob);
                            break;
                        }
                    }
                });
            }
        });
        client.router.match("self::iq", function (stanza) {
            node.children.iqs.content.write(stanza.toString() + "\n");
        });

    });
    callback(fs.E.OK);
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

    try {
        f4js.start(options.mount, fs.createRouter(root, options), options.debug);
    } catch (err) {
        console.log("Exception when starting file system: " + err);
    }
}

main();