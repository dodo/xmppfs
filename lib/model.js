var path = require('path');
var inherits = require('inherits');
var JID = require('node-xmpp').JID;
var util = require('../util');
var fs = require('../fs');

var Client = exports.Client = require('./client').Client;
var Model = exports.Model = require('./base').Model;

var A = {
  subscribe:   "asked contact to see her/his status",
  authorize:   "contact asks to see your status",
  unauthorize: "contact asks to be removed from your roster",
  undefined:   "nothing. move along",
};

exports.Resource = Resource;
inherits(Resource, Model);
function Resource(parent, attrs) {
    Resource.super.call(this, attrs);
    this.contact = parent;
    console.error(this.contact.account.jid+" new resource "+this.get('jid'));
    this.node = parent.node.add(""+this.get('jid').resource, new fs.Directory());
    this.node.contact = parent;
    this.node.model = this;
    this.node.add("resource", new fs.File(""+this.get('jid').resource))
        .setMode("r--r--r--")
        .save(""+this.get('jid').resource);
    this.on('change state', function (value) {
        this.node.add("state", new fs.State(["online", "offline"], value))
            .setMode("r--r--r--")
            .setState(value);
    });
    var resource = this;
    // pipe messages from xmpp to filesystem and back
    this.on('message', function (message, stanza) {
        resource.contact.account.node.add("" + resource.get('jid').bare(),
                                          resource.contact.node);
        this.writeIn(message);
    }.bind(this.node.add("messages", new fs.Chat(this.contact.account.client))
    .on('message', function (message) {
        this.writeOut(resource.get('jid'), message);
    }.bind(this.contact.account.client)).clear()));
    // pipe presence
    this.on('presence', function (stanza) {
        this.content.write(stanza.toString() + "\n");
    }.bind(this.node.add("presence.xml", new fs.File()).setMode("r--r--r--")));
    // pipe the rest …
    ["status","priority","show","os","version","client","device","features"].forEach(
    function (name) {
        this.on('change '+name, function   (value) {
            this.node.add(name, new fs.File(value))
                .setMode("r--r--r--")
                .save(value);
        });
    }.bind(this));
    this.on('change', function (key, value, oldvalue) {
        console.log(this.get('jid')+":change",key,": ",oldvalue,"→",value)
    });
};


exports.Contact = Contact;
inherits(Contact, Model);
function Contact(parent, attrs, node, jid) {
    attrs = attrs || {};
    if (jid && !attrs.name) attrs.name = "" + jid;
    Contact.super.call(this, attrs);
    console.error(parent.jid+" new contact "+this.get('name'));
    this.account = parent,
    this.resources = {};
    this.groups = [];
    this.node = node || new fs.Directory();
    if (!this.node.name) this.onname(this.get('name'));
    this.onvisible(this.get('visible'));
    this.node.contact = this;
    this.node.model = this;
    if (jid) this.add(jid);
    this.on('change visible', this.onvisible.bind(this));
    this.on('change name', this.onname.bind(this));
    this.on('change', function (key, value, oldvalue) {
        console.log("contact",this.account.jid+":change",key,": ",oldvalue,"→",value)
    });
    // add desktop entry
    var entry = this.node.add(new fs.DesktopEntry({})).setOptions({
        Version:"1.0",
        Type:"Directory",
        MimeType:"inode/directory;",
        Name:"Contact",
        Comment:""+this.get('name'),
        Icon:"user-identity",
    });
    this.on('change hash', function (hash) {
        entry.setOptions({Icon:path.join(
            this.account.options.mount,"photos",hash)});
    }).on('change name', function (name) {
        entry.setOptions({Comment:name});
    });
    // pipe vcard
    this.on('vcard', function (hash, vcard, xml) {
        this.node.add("vcard.xml", new fs.File()).setMode("r--r--r--")
           .save("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"+xml.toString());
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
                var f = this.node.add(name, new fs.File(blob))
                    .setMode("r--r--r--")
                    .save(blob);
                this.node.add(".avatar", f);
                this.account.emit('photo', hash, f);
                this.set('hash', hash);
            } else if (vcard[i].name === "NICKNAME" &&
                      (text = vcard[i].getText())) {
                this.set('name', text);
            }
        }
    });
}

Contact.prototype.onvisible = function (state) {
    this.node.hidden = !state;
};

Contact.prototype.onname = function (name) {
    this.node.name = "" + name;
};

Contact.prototype.resourceNodes = function () {
    return Object.keys(this.resources).map(function (key) {
        return this.resources[key].node;
    }.bind(this));
};

Contact.prototype.add = function (jid) {
    var resource = this.resources[jid];
    if (!resource) {
        resource = new Resource(this, {jid:jid});
        this.resources[jid] = resource;
        this.emit('add', resource, jid.resource);
    }
    return resource;
};


exports.Roster = Roster;
inherits(Roster, Model);
function Roster(parent, attrs) {
    attrs = attrs || {};
    attrs.visible = false;
    Roster.super.call(this, attrs);
    this.subscriptions = {};
    this.account = parent;
    parent.on('add', this.oncontact.bind(this));
    ['item','add','remove','subscribe','unsubscribe','online','offline'].forEach(
    function (event) {
        this.on(event, this["on"+event].bind(this));
    }.bind(this));
    this.node = parent.node.add("roster", new fs.Directory());
    this.node.add(new fs.DesktopEntry({})).setOptions({
        Version:"1.0",
        Type:"Directory",
        MimeType:"inode/directory;",
        Name:"Roster",
        Icon:"x-office-address-book",
    });
    this.on('change visible', this.onvisible.bind(this));
    this.onvisible(this.get('visible'));
    this.node.model = this;
}
Roster.prototype.onvisible = Contact.prototype.onvisible;

Roster.prototype.ononline = function (from, stanza) {
    var jid = this.account.add(from);
    jid.set('state', "online");
    jid.contact.set('visible', true);
};

Roster.prototype.onoffline = function (from, stanza) {
    var jid = this.account.add(from);
    jid.set('state', "offline");
    var xxx = [];
    jid.contact.set('visible', jid.contact.resourceNodes().some(function(node){
        xxx.push(node.model.get('jid') + " " + node.model.get('state'))
        return node.model.get('state') === "online";
    }));
};

Roster.prototype.onitem = function (item) {
    console.log("item",item)
    var jid = new JID(item.jid);
    var contact = this.account.add(jid).contact
    contact.set('subscription', item.subscription);
    contact.set('ask', item.ask);
};

Roster.prototype.oncontact = function (contact, barejid) {
    this.node.add(""+barejid, contact.node);
    console.error(contact.account.jid+" oncontact", contact.get('name'), "("+barejid+")");
    if (!this.subscriptions[barejid]) {
        var f = this.subscriptions[barejid] = contact.node.add("subscription",
          new fs.State(["none", "from", "to", "both"]))
            .setState("none");
        f.on('state', this.onstate.bind(this, barejid, f));
        f.on('state', function (state, dir) {
            console.error(""+this.account.jid,"changed subscription",f.content,(dir=='in'?"←":"→"),state)
            if (dir === 'in') contact.set('subscription', state);
        }.bind(this));
        contact.on('change subscription', function (state) {f.setState(state)});
        contact.on('change ask', function (ask) {
//             if (!~["subscribe"])
            var file = contact.node.add("ask", new fs.File())
                .setMode("r--r--r--");
//             if (!ask) file.remove();
//             else file.save(""+ask);
            file.save(A[""+ask]);
        });
    }
};

Roster.prototype.onstate = function (barejid, file, state, dir) {
    if (dir === 'out' || !this.account.client) return;
    this.emit('subscription', barejid, state, file.content);
};

Roster.prototype.onadd = function (from, stanza) {
    // subscription + 'from'
    var contact = this.account.add(from.bare()).contact;
    var oldstate = contact.get('subscription');
    if (oldstate == "none") contact.set('subscription', "from");
    if (oldstate == "to")   contact.set('subscription', "both");
    if (contact.get('ask') === "subscribe") contact.set('ask');
};

Roster.prototype.onremove = function (from, stanza) {
    // subscription - 'from'
    var contact = this.account.add(from.bare()).contact;
    var oldstate = contact.get('subscription');
    if (oldstate == "both") contact.set('subscription', "to");
    if (oldstate == "from") contact.set('subscription', "none");
    if (contact.get('ask') === "unsubscribe") contact.set('ask');
};

Roster.prototype.onsubscribe = function (from, stanza) {
    this.account.add(from.bare()).contact.set('ask', "authorize");
};

Roster.prototype.onunsubscribe = function (from, stanza) {
    this.account.add(from.bare()).contact.set('ask', "unauthorize");

};


exports.Account = Account;
inherits(Account, Model);
function Account(jid, attrs, options, node) {
    Account.super.call(this, attrs);
    this.options = options || {};
    this.jid = jid.bare();
    this.contacts = {};
    this.do_register = false;
    var contact = this.add(this.jid, node).contact;
    contact.on('change hash', this.emit.bind(this, 'hash'));
    this.node = node = contact.node; // always need barejid
    this.roster = new Roster(this, {});
    this.roster.oncontact(contact, this.jid);
    if (jid.resource) this.add(jid, node);
    ["status","priority","show","password","resource"].forEach(
    function (name) {
        node.add(name, new fs.File(this.get(name)))
            .on('content', function (value) {
                this.set(name, value.toString('utf8'));
            }.bind(this));
    }.bind(this));
    if (jid.resource)
        node.add("resource", new fs.File(jid.resource)).save(jid.resource);
    this.on('iq', function (stanza) {
        this.content.write(stanza.toString() + "\n");
    }.bind(node.add("iq.xml", new fs.File()).setMode("r--r--r--")));
    this.set('state', "offline");
    node.add("state", new fs.State(["online", "offline", "register"], "offline"))
        .on('state', this.set.bind(this, 'state'));
    this.on('change state', this.onstate.bind(this));
    this.on('change', function (key, value, oldvalue) {
        console.log("changed",key,": ",oldvalue,"→",value)
    });
}

Account.prototype.add = function (jid, node) {
    var barejid = jid.bare();
    var contact = this.contacts[barejid];
    if (!contact) {
        contact = new Contact(this, {}, node, jid);
        this.contacts[barejid] = contact;
        this.emit('add', contact, barejid);
    }
    return contact.add(jid);
};

Account.prototype.onstate = function (state) {
    if (state === "offline") {
        if (this.client) {
            console.log("disconnect client %s …", this.jid.toString());
            this.client.end();
            this.client = null;
        }
        return;
    }
    if (state === "register") {
        this.do_register = true;
        return process.nextTick(function () {
            this.node.children.state.setState("online");
        }.bind(this));
    }
    if (this.client) return;

    var account = this, node = this.node;
    var client = this.client = new Client({});
    client.on('connect', this.emit.bind(this, 'client'));
    client.on('roster', this.roster.emit.bind(this.roster));
    client.on('online', function () {
        if (!account.client) account.client = client;
        node.children.resource.content.reset();
        node.children.resource.setMode("r--r--r--");
        node.children.resource.content.write("" + account.jid.resource);
        node.children.state.setState(account.attributes.state = "online");
    });
    client.on('offline', function () {
        node.children.state.setState(account.attributes.state = "offline");
        node.children.resource.setMode("rw-rw-rw-");
        node.children.password.setMode("rw-rw-rw-");
        account.emit('client closed'); // FIXME missing condition (reconnect?)
    });
    client.on('info', function (from, info) {
        if (info.err) console.error("info fetch errored:", info.err);
        var jid = account.add(from);
        info.identities.forEach(function (c) {
            if (c.category == "client") {
                if (c.name) jid.set('client', c.name);
                if (c.type) jid.set('device', c.type);
            }
        });
        if (info.features.length)
            jid.set('features', info.features.join("\n"));
    });
    client.on('version', function (from, version) {
        var jid = account.add(from);
        Object.keys(version).forEach(function (key) {
            if (version[key])
                jid.set(key === 'name' ? 'client' : key, version[key]);
        });
    });
    account.roster.on('subscription', client.subscription.bind(client));
    account.jid.setResource(account.get('resource'));
    console.log("connect client %s …", account.jid.toString());
    if (this.do_register)
         client.register(account);
    else client.connect(account);
    this.do_register = false;

};

