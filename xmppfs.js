var Path = require('path');
var xmpp = require('node-xmpp');
var f4js = require('fuse4js');

var fs = require('./fs');
var util = require('./util');
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

function openChat(node, from) {
    var name = from.bare().toString();
    if (node.chats[name]) {
        return node.chats[name].openChat(util.escapeResource(from.resource));
    }
    var open = function (resource) {
        var chat = jid.add(resource, new fs.Directory({
            messages: new fs.Chat(node),
            presence: new fs.File(),
        }));
        if (resource != "undefined") {
            chat.add("state", new fs.State(["online", "offline"], "offline"))
                .setMode("r--r--r--");
        }
        chat.children.presence.setMode("r--r--r--");
        chat.children.messages.on('message', function (message) {
            var to = new xmpp.JID(name);
            to.setResource(resource == "undefined" ? undefined : resource);
            node.client.send(new xmpp.Message({to:to, type:'chat'})
                .c('body').t(message));
        });
        return chat;
    }
    var jid = node.add(name, new fs.Directory());
    jid.add(new fs.DesktopEntry({
        Version:"1.0",
        Type:"Directory",
        MimeType:"inode/directory;",
        Name:"Contact",
        Comment:name,
        Icon:"user-identity",
    }));
    node.chats[name] = jid;
    jid.openChat = open;
    jid.setMode("r-xr-xr-x");
    jid.mkdir = function (resource, mode, callback) {
        open(resource);
        callback(fs.E.OK);
    };
    return open(util.escapeResource(from.resource));
}

function getChat(node, stanza) {
    var chat, from = new xmpp.JID(stanza.attrs.from);
    if (!(chat = node.chats[from.bare().toString()]))
        chat = openChat(node, from);
    else if (!(chat = chat.children[util.escapeResource(from.resource)]))
        chat = openChat(node, from);
    return chat;
}

var connections = 0;
var root = new fs.Directory({photos:new fs.Directory()});
root.children.photos.hidden = true;
root.mkdir = function (name, mode, callback) {
    var jid = new xmpp.JID(name);
    console.log("create new jid " + jid);
    var node = this.add(jid.bare().toString(), new fs.Directory({
        roster:   new fs.Directory(),
        password: new fs.File("secret"),
        resource: new fs.File(jid.resource),
        state:    new fs.State(["online", "offline"], "offline"),
        status:   new fs.File("dodo is using this for tests"),
        priority: new fs.File("0"),
        show:     new fs.File("chat"),
        iqs:      new fs.File(),
    }));
    node.chats = {};
    node.jid = jid;
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
    node.children.roster.add(new fs.DesktopEntry({
        Icon:"x-office-address-book",
    }));
    node.children.state.on('state', function (state) {
        if (state === "offline") {
            if (node.client) {
                console.log("disconnect client %s …", node.jid.toString());
                if (node.client.connection.socket) node.client.end();
                delete node.client;
            }
            return;
        }
        if (node.client) return;
        node.jid.setResource(node.children.resource.content.toString('utf8'));
        console.log("connect client %s …", node.jid.toString());
        var client = node.client = new xmpp.Client({jid:node.jid,
            password:node.children.password.content.toString('utf8')});
        client.on('error', console.error.bind(console,"clientErr ="));
        node.children.password.setMode("r--r--r--");
        node.children.roster.client = client;
        client.router = new Router(client);
        client.router.on('error', console.error.bind(console,"routerErr ="));
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
            client.router.f.presence.probe(client.jid.bare());
            client.router.f.roster.get(function (err, stanza, items) {
                if (err) return console.error("roster:",err);
                items.forEach(function (item) {
                    console.log(item.attrs);
                    var barejid = (new xmpp.JID(item.attrs.jid)).bare().toString();
                    var isnew = !node.children.roster.children[barejid];
                    var chat = getChat(node.children.roster,
                                       {attrs:{from:item.attrs.jid}});
                    if (isnew) chat.parent.hidden = true;
                    if (!chat.children.subscription) {
                        var f = chat.add("subscription", new fs.State(
                            ["from", "to", "both"],
                            item.attrs.subscription));
                        client.router.f.presence.probe(barejid);
                    }
                    chat.children.subscription.setState(item.attrs.subscription);
                });
            });
        });
        client.on('close', function () {
            node.children.roster.hidden = true;
            node.children.state.setState("offline");
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
            var message = stanza.getChildText('body');
            if (message) {
                if (chat.parent && !node.chats[chat.parent.name]) {
                    node.children[chat.parent.name] = chat.parent;
                    node.chats[chat.parent.name] = chat.parent;
                }
                chat.children.messages.writeIn(message);
            }
        });
        client.router.on('presence', function (stanza) {
            var chat = getChat(node.children.roster, stanza);
            chat.parent.hidden = !!stanza.attrs.type;
            if (chat.children.state) {
                chat.children.state.setState(
                    chat.parent.hidden ? "offline" : "online");
            }
            chat.children.presence.content.write(stanza.toString() + "\n");
            ;["show","status","priority"].forEach(function (name) { var text;
                if ((text = stanza.getChildText(name))) {
                    if (!chat.children[name])
                        chat.add(name, new fs.File(text)).setMode("r--r--r--");
                    chat.children[name].content.reset();
                    chat.children[name].content.write(text);
                }
            });
        });
        client.router.f.vcard.on('update', function (stanza, match) { var hash;
            var chat = getChat(node.children.roster, stanza);
            match = match.filter(function (m) {return typeof(m)!=='string'});
            if ((hash = match[0].getChildText("photo"))) {
                client.router.f.vcard.get(stanza.attrs.from,
                                          function (err, stanza, vcard) {
                    if (err) return console.error("fetch errored:", err);
                    for (var text, i = 0; i < vcard.length ; i++) {
                        if (vcard[i].name === "PHOTO" &&
                           (text = vcard[i].getChildText("BINVAL"))) {
                            var blob = new Buffer(text, 'base64');
                            var ext = "";
                            if ((ext = vcard[i].getChildText("TYPE")))
                                ext = ext.replace("image/",".");
                            else ext = "";
                            var name = "avatar" + ext;
                            if (!chat.parent.children[name]) {
                                var f = chat.parent.add(name, new fs.File(blob));
                                root.children.photos.add(hash, f);
                                chat.parent.add(".avatar", f);
                                f.setMode("r--r--r--");
                                if (client.jid.bare().equals(
                                    (new xmpp.JID(stanza.attrs.from)).bare())) {
                                    node.add(".avatar", f);
                                    node.add(name, f);
                                }
                            }
                            chat.parent.children[".avatar"].content.reset();
                            chat.parent.children[".avatar"].content.write(blob);

                            chat.parent.children[".directory"].setOptions({
                                Icon:Path.join(options.mount, "photos", hash),
                            });
                        } else if (vcard[i].name === "NICKNAME" &&
                                  (text = vcard[i].getText())) {
                            chat.parent.children[".directory"].setOptions({
                                Comment:text,
                            });
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