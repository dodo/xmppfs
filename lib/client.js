var inherits = require('inherits');
var extend = require('extend');
var xmpp = require('node-xmpp');
var moment = require('moment');
var Model = require('./base').Model;
var feature = require('../feature');

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
    Client.super.call(this, attrs);
    this.feature = {};
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
    if (this.handle.connection && this.handle.connection.socket)
        this.handle.end();
};

proto.subscribe = function (jid, message) {
    this.feature.roster.subscribe(jid, message);
};

proto.subscription = function (barejid, state, oldstate) {
    console.error("SUB", barejid,":", oldstate, "→", state);
    var roster = this.feature.roster;
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
    this.account = account;
    this.handle = new xmpp.Client({
        password:account.get('password'),
        register:register,
        reconnect:true,
        jid:account.jid,
    });
    this.handle.on('error', console.error.bind(console,"clientErr ="));
    this.handle.connection.on('error', function (err) {
        console.error("connection errored: " + err);
    });
    this.handle.connection.socket.on('error', function (err) {
        console.error("socket errored: " + err);
    });
    this.handle.on('stanza', this.setupRouter());
    this.emit('connect', this.handle);
    this.setupFeatures();
    this.setupHooks();
    return this;
};

proto.setupRouter = function () {
    this.router = new feature.Router(this.handle);
    this.router.on('error', console.error.bind(console,"routerErr ="));
    this.router.on('send presence', function (presence) {
        if (presence.attrs.type) return;
        presence.attrs['xml:lang'] = moment.lang();
    });
    return this.router.onstanza;
};

proto.setupFeatures = function () {
    var cache = {};
    this.feature.disco    = new feature.Disco( this.router, cache);
    this.feature.vcard    = new feature.VCard( this.router);
    this.feature.presence = new feature.Presence(this.router);
    this.feature.roster   = new feature.Roster(this.router, this.feature.disco);
    this.feature.ping     = new feature.Ping(  this.router, this.feature.disco);
    this.feature.version  = new feature.Version(this.router,
        extend({disco:this.feature.disco}, VERSION));
    this.feature.roster.on('error', console.error.bind(console,"roster fetch errored:"));
};

proto.setupHooks = function () {
    this.handle.connection.on('connect', this.onconnect.bind(this));
    this.handle.on('online', this.ononline.bind(this));
    this.handle.on('close', this.onclose.bind(this));
    this.router.match("self::message", this.onmessage.bind(this));
    this.router.match("self::iq", this.oniq.bind(this));
    this.router.on('presence', this.onpresence.bind(this));
    this.feature.vcard.on('update', this.onvcardupdate.bind(this));
    this.handle.on('end', function () {
        console.log("client end event", this.jid.toString()) // FIXME
    });
    ["add","remove","online","offline","subscribe","unsubscribe"].forEach(
    function (event) {
        this.feature.roster.on(event, this.emit.bind(this, 'roster', event));
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
    this.feature.presence.send({ to:to,
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
    this.feature.presence.probe(jid);
    this.fetchVCard(jid, resource.contact);
    this.feature.version.fetch(jid, this.onversion.bind(this, jid));
    this.feature.roster.get(function (items) {
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
    var disco = this.feature.disco;
    var addr = this.handle.connection.socket.address();
    var i; if ((i = disco.features.indexOf("ipv6")) === -1) {
        if (addr.family == "IPv6") disco.addFeature("ipv6");
    } else if (addr.family == "IPv4")
        disco.features.splice(i, 1);
};

proto.onclose = function () {
    if (!this.handle) return console.error("no handle!");
    this.feature.disco.clearCache();
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
    this.feature.disco.info(from, this.ondiscoinfo.bind(this, from));
};

proto.ondiscoinfo = function (from, err, info) {
    if (err) info = {identities:[],features:[], err:err}; // no info? bad luck i guess
    this.emit('info', from, info);
    this.feature.version.fetch(from, this.onversion.bind(this, from));
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
    this.feature.vcard.get(from, this.onvcard.bind(this, contact, hash));
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
