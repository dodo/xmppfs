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

var VERSION = {
    type:"filesystem",
    category:"client",
    version:"alpha",
    name:"xmppfs",
    os:"unix",
};

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
        var chat = jid.add(resource, new fs.Directory());
        chat.protected = true;
        chat.add("presence.xml", new fs.File()).setMode("r--r--r--");
        chat.add("messages", new fs.Chat(node)).on('message', function (message) {
            var to = new xmpp.JID(name);
            to.setResource(resource == "undefined" ? undefined : resource);
            node.client.send(new xmpp.Message({to:to, type:'chat'})
                .c('body').t(message));
        });
        if (resource != "undefined") {
            chat.add("state", new fs.State(["online", "offline"], "offline"))
                .setMode("r--r--r--");
        }
        return chat;
    }
    var isnew = !node.children[name];
    var jid = node.add(name, new fs.Directory());
    node.chats[name] = jid;
    jid.openChat = open;
    jid.setMode("r-xr-xr-x");
    jid.protected = true;
    jid.add(new fs.DesktopEntry({
        Version:"1.0",
        Type:"Directory",
        MimeType:"inode/directory;",
        Name:"Contact",
        Comment:name,
        Icon:"user-identity",
    })).protected = true;
    jid.mkdir = function (resource, mode, callback) {
        this.openChat(resource);
        callback(fs.E.OK);
    };
    if (!isnew) Object.keys(jid.children).forEach(function (resource) {
        if (resource == from.resource) return;
        if (jid.children[resource].protected) return;
        if (jid.children[resource].prefix === "d")
            jid.openChat(resource);
    });
    return jid.openChat(util.escapeResource(from.resource));
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
        'iqs.xml':new fs.File(),
    }));
    node.add(new fs.DesktopEntry({
        Version:"1.0",
        Type:"Directory",
        MimeType:"inode/directory;",
        Name:"Contact",
        Comment:name,
        Icon:"user-identity",
    })).protected = true;
    node.chats = {};
    node.jid = jid;
    node.mkdir = function (from, mode, callback) {
        from = new xmpp.JID(from).bare();
        var barejid = from.toString();
        var chat = getChat(node.children.roster, {attrs:{from:barejid}});
        if (chat.parent && !node.chats[chat.parent.name]) {
            node.children[chat.parent.name] = chat.parent;
            node.chats[chat.parent.name] = chat.parent;
        }
        if (node.client)
            node.client.router.f.presence.probe(from);
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
    node.children.roster.setMode("rwxr-xr-x");
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
        var onclose = function () {if (client.connection.socket) client.end()};
        process.on('close connection', onclose);
        connections++;
        client.router.on('send presence', function (presence) {
            if (presence.attrs.type) return;
            presence.attrs['xml:lang'] = moment.lang();
        });
        client.router.f = {};
        client.router.f.disco    = new Disco( client.router, {});
        client.router.f.vcard    = new VCard( client.router);
        client.router.f.presence = new Presence(client.router);
        client.router.f.roster   = new Roster(client.router, client.router.f.disco);
        client.router.f.ping     = new Ping(  client.router, client.router.f.disco);
        client.router.f.version  = new Version(client.router,
            extend({disco:client.router.f.disco}, VERSION));
        client.router.f.roster.on('error', console.error.bind(console,"roster fetch errored:"));
        client.on('stanza', client.router.onstanza);
        client.connection.on('error', function (err) {
            console.error("connection errored: " + err);
        });
        client.connection.on('connect', function () {
            var disco = client.router.f.disco;
            var addr = client.connection.socket.address();
            var i; if ((i = disco.features.indexOf("ipv6")) === -1) {
                if (addr.family == "IPv6") disco.addFeature("ipv6");
            } else if (addr.family == "IPv4")
                disco.features.splice(i, 1);
        });
        var onvcard = function (hash, err, stanza, vcard) { var chat = this;
            if (err) return console.error("vcard fetch errored:", err, ""+stanza);
            var isclient = client.jid.equals((new xmpp.JID(stanza.attrs.from)));
            var vcardxml = stanza.getChild("vCard").clone();
            delete vcardxml.attrs.xmlns;
            vcardxml = new xmpp.Element("vcards",
                {xmlns:"urn:ietf:params:xml:ns:vcard-4.0"})
                .cnode(vcardxml).up();
            var vcardfile = chat.parent.add("vcard.xml", new fs.File());
            if (isclient) node.add(vcardfile);
            vcardfile.setMode("r--r--r--");
            vcardfile.content.reset();
            vcardfile.content.write(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                +   vcardxml.toString());
            for (var text, i = 0; i < vcard.length ; i++) {
                if (vcard[i].name === "PHOTO" &&
                    (text = vcard[i].getChildText("BINVAL"))) {
                    var blob = new Buffer(text, 'base64');
                    var ext = "";
                    if ((ext = vcard[i].getChildText("TYPE")))
                        ext = ext.replace("image/",".");
                    else ext = "";
                    var name = "avatar" + ext;
                    hash = hash || util.sha1(blob);
                    if (!chat.parent.children[name]) {
                        var f = chat.parent.add(name, new fs.File(blob));
                        root.children.photos.add(hash, f);
                        chat.parent.add(".avatar", f);
                        f.setMode("r--r--r--");
                        if (isclient) {
                            client.router.f.vcard.setPhotoHash(hash);
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
        };
        var onversion = function (from, err, version) { var chat = this;
            if (err) return console.error(
                "fetching version from",from,":", err);
            var isclient = client.jid.equals((new xmpp.JID(from)));
            Object.keys(version).forEach(function (key) {
                if (version[key]) {
                    var f = chat.add(key=="name"?"client":key, new fs.File());
                    if (isclient) node.add(f);
                    f.setMode("r--r--r--");
                    f.content.reset();
                    f.content.write(version[key]);
                }
            });
        }
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
            var barejid = client.jid.bare().toString();
            var chat = getChat(node.children.roster, {attrs:{from:""+client.jid}})
            client.roster_fetched = false;
            client.router.f.presence.probe(barejid);
            client.router.f.vcard.get(barejid, onvcard.bind(chat, null));
            client.router.f.version.fetch(""+client.jid,onversion.bind(chat,""+client.jid));
            client.router.f.roster.get(function (items) {
                items.forEach(function (item) {
                    console.log(item);
                    var barejid = (new xmpp.JID(item.jid)).bare().toString();
                    var isnew = !node.children.roster.children[barejid];
                    var chat = getChat(node.children.roster,
                                       {attrs:{from:item.jid}});
                    if (isnew) {
                        chat.parent.hidden = true;
                        client.router.f.presence.probe(item.jid);
                        client.router.f.vcard.get(barejid, onvcard.bind(chat, null));
                    }
                    if (!chat.children.subscription ||
                         chat.children.subscription.constructor == fs.File) {
                        var f = chat.add("subscription", new fs.State(
                            ["none", "from", "to", "both"],
                            item.subscription));
                        f.on('state', function (state, dir) {
                            if (dir === 'out') return;
                            var oldstate = this.content;
                                   if (oldstate == "from" && state === "to") {
                                client.router.f.roster.unauthorize(barejid);
                                client.router.f.roster.subscribe(barejid);
                            } else if (oldstate == "to" && state === "from") {
                                client.router.f.roster.authorize(barejid);
                                client.router.f.roster.unsubscribe(barejid);
                            } else if (oldstate == "from" && state === "both") {
                                client.router.f.roster.subscribe(barejid);
                            } else if (oldstate == "both" && state === "from") {
                                client.router.f.roster.unsubscribe(barejid);
                            } else if (oldstate == "from" && state === "none") {
                                client.router.f.roster.unauthorize(barejid);
                            } else if (oldstate == "none" && state === "from") {
                                client.router.f.roster.authorize(barejid);
                            } else if (oldstate == "both" && state === "to") {
                                client.router.f.roster.unauthorize(barejid);
                            } else if (oldstate == "to" && state === "both") {
                                client.router.f.roster.authorize(barejid);
                            } else if (oldstate == "both" && state === "none") {
                                client.router.f.roster.unsubscribe(barejid);
                                client.router.f.roster.unauthorize(barejid);
                            } else if (oldstate == "none" && state === "both") {
                                client.router.f.roster.subscribe(barejid);
                                client.router.f.roster.authorize(barejid);
                            } else if (oldstate == "to" && state === "none") {
                                client.router.f.roster.unsubscribe(barejid);
                            } else if (oldstate == "none" && state === "to") {
                                client.router.f.roster.subscribe(barejid);
                            }
                        });
                    }
                    chat.children.subscription.setState(item.subscription);
                });
                client.roster_fetched = true;
            });
        });
        client.on('close', function () {
            client.router.f.disco.clearCache();
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
            if (stanza.attrs.type === "error")
                console.error("message", stanza.toString());
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
            if (stanza.attrs.type === "error")
                console.error("presence", stanza.toString());
            var chat = getChat(node.children.roster, stanza);
            chat.parent.hidden = !!stanza.attrs.type;
            if (chat.children.state) {
                chat.children.state.setState(
                    chat.parent.hidden ? "offline" : "online");
            }
            if (client.roster_fetched && !chat.parent.hidden) {
                client.router.f.disco.info(stanza.attrs.from, function (err, info) {
                    if (err) info = {identities:[],features:[]}; // no info? bad luck i guess
                    info.identities.forEach(function (c) {
                        if (c.category == "client") {
                            console.log(chat.parent.name+"/"+chat.name, c)
                            if (c.name) {
                                var f = chat.add("client", new fs.File());
                                f.setMode("r--r--r--");
                                f.content.reset();
                                f.content.write(c.name);
                            }
                            if (c.type) {
                                var f = chat.add("device", new fs.File());
                                f.setMode("r--r--r--");
                                f.content.reset();
                                f.content.write(c.type);
                            }
                        }
                    });
                    if (info.features.length) {
                        var f = chat.add("features", new fs.File());
                        f.setMode("r--r--r--");
                        f.content.reset();
                        f.content.write(info.features.join("\n"));
                    }
                    client.router.f.version.fetch(stanza.attrs.from,
                        onversion.bind(chat, stanza.attrs.from));
                });
            }
            chat.children["presence.xml"].content.write(stanza.toString() + "\n");
            ;["show","status","priority"].forEach(function (name) { var text;
                if ((text = stanza.getChildText(name))) {
                    if (!chat.children[name])
                        chat.add(name, new fs.File(text)).setMode("r--r--r--");
                    chat.children[name].content.reset();
                    chat.children[name].content.write(text);
                }
            });
        });
        client.router.f.vcard.on('update', function (stanza, match) {
            var chat = getChat(node.children.roster, stanza);
            if (!client.roster_fetched) return;
            match = match.filter(function (m) {return typeof(m)!=='string'});
            if(!match.length) return;
            client.router.f.vcard.get(stanza.attrs.from,
                onvcard.bind(chat, match[0].getChildText("photo")));
        });
        client.router.match("self::iq", function (stanza) {
            if (stanza.attrs.type === "error")
                console.error("iq", stanza.toString());
            node.children['iqs.xml'].content.write(stanza.toString() + "\n");
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