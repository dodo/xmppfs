var inherits = require('util').inherits;
var extend = require('extend');
var xmpp = require('node-xmpp');
var Lightstream = require('lightstream');
var moment = require('moment');
var Model = require('./base').Model;

var VERSION = {
    type:"filesystem",
    category:"client",
    version:"alpha",
    name:"xmppfs",
    os:"unix",
};


exports.Client = Client;
inherits(Client, Model)
function Client(attrs) {
    Client.super_.call(this, attrs);
    this._fetched_info = {};
    this._fetched_vcard = {};
}
var proto = Client.prototype;

proto.writeOut = function (to, message) {
    to.setResource(""+to.resource == "undefined" ? undefined : to.resource);
    this.handle.send(new xmpp.Message({to:to, type:'chat'})
        .c('body').t(message));
};

proto.end = function () {
    this.handle.send(new xmpp.Presence({type:'unavailable',from:this.handle.jid}));
    if (this.handle.backend.client.connection && this.handle.backend.client.connection.socket)
        this.handle.end();
};

proto.subscribe = function (jid, message) {
    this.handle.extension.roster.subscribe(jid, message);
};

proto.subscription = function (barejid, state, oldstate) {
    console.error("SUB", barejid,":", oldstate, "→", state);
    var roster = this.handle.extension.roster;
           if (oldstate == "from" && state === "to") {
        roster.unauthorize(barejid);
        roster.subscribe(barejid);
    } else if (oldstate == "to" && state === "from") {
        roster.authorize(barejid);
        roster.unsubscribe(barejid);
    } else if (oldstate == "from" && state === "both") {
        roster.subscribe(barejid);
    } else if (oldstate == "both" && state === "from") {
        roster.unsubscribe(barejid);
    } else if (oldstate == "from" && state === "none") {
        roster.unauthorize(barejid);
    } else if (oldstate == "none" && state === "from") {
        roster.authorize(barejid);
    } else if (oldstate == "both" && state === "to") {
        roster.unauthorize(barejid);
    } else if (oldstate == "to" && state === "both") {
        roster.authorize(barejid);
    } else if (oldstate == "both" && state === "none") {
        roster.unsubscribe(barejid);
        roster.unauthorize(barejid);
    } else if (oldstate == "none" && state === "both") {
        roster.subscribe(barejid);
        roster.authorize(barejid);
    } else if (oldstate == "to" && state === "none") {
        roster.unsubscribe(barejid);
    } else if (oldstate == "none" && state === "to") {
        roster.subscribe(barejid);
    }
};

proto.register = function (account) {
    return this.connect(account, true);
};

proto.connect = function (account, register) {
    var xep = require('lightstream/xep');
    this.account = account;
    this.handle = new Lightstream({
        backend:require('lightstream/backend/node-xmpp'),
        cache:{},
    }).use(xep.Disco, xep.VCard, xep.Presence, xep.Roster, xep.Ping, xep.Version)
      .connect(account.jid, account.get('password'), {
        register:register,
        reconnect:true,
    });
    this.handle.on('error', console.error.bind(console,"clientErr ="));
    this.handle.router.on('error', console.error.bind(console,"routerErr ="));
    this.handle.router.on('send presence', function (presence) {
        if (presence.attrs.type) return;
        presence.attrs['xml:lang'] = moment.lang();
    });
    this.handle.backend.client.connection.on('error', function (err) {
        console.error("connection errored: " + err);
    });
    this.handle.backend.client.connection.socket.on('error', function (err) {
        console.error("socket errored: " + err);
    });
    this.emit('connect', this.handle.backend.client); // FIXME
    this.setupFeatures();
    this.setupHooks();
    return;
};

proto.setupFeatures = function () {
    var handle = this.handle;
    Object.defineProperty(handle, 'jid', {
        get: function() {
            return handle.backend.client.jid;
        }
    });
    handle.extension.version.set(VERSION);
    handle.extension.roster.on('error', console.error.bind(console,"roster fetch errored:"));
    this.account.on('hash', handle.extension.vcard.setPhotoHash.bind(handle.extension.vcard));
};

proto.setupHooks = function () {
    this.handle.backend.client.connection.on('connect', this.onconnect.bind(this));
    this.handle.backend.client.on('online', this.ononline.bind(this));
    this.handle.backend.client.on('close', this.onclose.bind(this));
    this.handle.router.match("self::message", this.onmessage.bind(this));
    this.handle.router.match("self::iq", this.oniq.bind(this));
    this.handle.router.on('presence', this.onpresence.bind(this));
    this.handle.extension.vcard.on('update', this.onvcardupdate.bind(this));
    this.handle.backend.client.on('end', function () {
        console.log("client end event", this.jid.toString()) // FIXME
    });
    ["add","remove","online","offline","subscribe","unsubscribe"].forEach(
    function (event) {
        this.handle.extension.roster.on(event, this.emit.bind(this, 'roster', event));
    }.bind(this));
};


proto.ononline = function () {
    console.log("client %s online.", this.handle.jid.toString());
    this.account.roster.set('visible', true);
    this.emit('online');
    this.sendPresence();
    this.fetch(this.handle.jid.bare());
};

proto.sendPresence = function (to) {
    this.handle.extension.presence.send({ to:to,
        priority: this.account.get('priority'),
        status: this.account.get('status'),
        show: this.account.get('show'),
        from: this.handle.jid,
    });
};

proto.fetch = function (jid) {
    if (this.fetched) return;
    this.fetched = true;
    // fetch newest presence, vcard and info from contacts jid
    var resource = this.account.add(jid); // FIXME
//     client.roster_fetched = false;
    this.handle.extension.presence.probe(jid);
    this.fetchVCard(jid, resource.contact);
    this.handle.extension.version.fetch(jid, this.onversion.bind(this, jid));
    this.handle.extension.roster.get(function (items) {
        items.forEach(function (item) {
            var jid = new xmpp.JID(item.jid);
            this.emit('roster', 'item', item);
            this.fetchVCard(jid, this.account.add(jid).contact);
        }.bind(this));
    }.bind(this));

};

proto.onconnect = function () {
    if (!this.handle) return console.error("no handle!");
    console.log("client connect event", this.handle.jid.toString())
    // detect ipv6 and advertize it
    var disco = this.handle.extension.disco;
    var addr = this.handle.backend.client.connection.socket.address();
    var i; if ((i = disco.features.indexOf("ipv6")) === -1) {
        if (addr.family == "IPv6") disco.addFeature("ipv6");
    } else if (addr.family == "IPv4")
        disco.features.splice(i, 1);
};

proto.onclose = function () {
    if (!this.handle) return console.error("no handle!");
    this.handle.extension.disco.clearCache();
    console.log("client %s offline.", this.handle.jid.toString());
    this.account.roster.set('visible', false);
    this.emit('offline');
};

proto.onmessage = function (stanza) {
    if (stanza.attrs.type === "error")
        return console.error("message", stanza.toString());
    var jid = this.account.add(new xmpp.JID(stanza.attrs.from));
    var message = stanza.getChildText('body');
    if (message) jid.emit('message', message, stanza);
};

proto.onpresence = function (stanza) {
    if (stanza.attrs.type === "error")
        return console.error("presence", stanza.toString());
    var jid = this.account.add(new xmpp.JID(stanza.attrs.from));
    if (stanza.attrs.type !== "unavailable") this.fetchInfo(jid.get('jid'));
    jid.emit('presence', stanza);
    ;["show","status","priority"].forEach(function (name) { var text;
        if ((text = stanza.getChildText(name))) {
            jid.set(name, text);
        }
    });
};

proto.onvcardupdate = function (stanza, match) {
    var jid = this.account.add(new xmpp.JID(stanza.attrs.from));
//     if (!client.roster_fetched) return;
    match = match.filter(function (m) {return typeof(m)!=='string'});
    if (!match.length) return;
    var hash = match[0].getChildText("photo");
    this.fetchVCard(new xmpp.JID(stanza.attrs.from), jid.contact, hash);
};

proto.oniq = function (stanza) {
    if (stanza.attrs.type === "error")
        return console.error("iq", stanza.toString());
    this.account.emit('iq', stanza);
};

proto.fetchInfo = function (from) {
    if (this._fetched_info[from.bare()]) return;
    this._fetched_info[from.bare()] = true;
    this.handle.extension.disco.info(from, this.ondiscoinfo.bind(this, from));
};

proto.ondiscoinfo = function (from, err, info) {
    if (err) info = {identities:[],features:[], err:err}; // no info? bad luck i guess
    this.emit('info', from, info);
    this.handle.extension.version.fetch(from, this.onversion.bind(this, from));
};

proto.onversion = function  (from, err, version) {
    if (err) return console.error(
        "fetching version from " + from,":", err);
    this.emit('version', from, version);
};

proto.fetchVCard = function (from, contact, hash) {
    if (hash) {
        if (contact.get('hash') === hash) return;
    } else {
        if (this._fetched_vcard[from.bare()]) return;
        this._fetched_info[from.bare()] = true;
    }
    this.handle.extension.vcard.get(from, this.onvcard.bind(this, contact, hash));
};

proto.onvcard = function (contact, hash, err, stanza, vcard) { var chat = this;
    if (err) return console.error("vcard fetch errored:", err, ""+stanza);
    var vcardxml = stanza.getChild("vCard").clone();
    delete vcardxml.attrs.xmlns;
    vcardxml = new xmpp.Element("vcards",
        {xmlns:"urn:ietf:params:xml:ns:vcard-4.0"})
        .cnode(vcardxml).up();
    contact.emit('vcard', hash, vcard, vcardxml);
};
