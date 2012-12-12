var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var xmpp = require('node-xmpp');
var util = require('./util');

var NS = {
    roster: 'jabber:iq:roster',
    private:'jabber:iq:private',
    delimiter:'roster:delimiter',
};

exports.Roster = Roster;
inherits(Roster, EventEmitter);
function Roster(router, disco) {
    Roster.super.call(this);
    this.router = router;
    router.match("self::roster:iq[@type=set]",
                 {roster:NS.roster},
                 this.update_items.bind(this));
    router.match("self::presence[@type=unavailable or not(@type)]",
                 this.update_presence.bind(this));
    if (disco) disco.addFeature(NS.roster);
};
Roster.NS = NS;
var proto = Roster.prototype;


proto.get = function (callback) {
    var id = util.id("roster");
    this.router.request("self::iq[@id='" + id + "']/roster:query/item",
                        {roster:NS.roster},
                        this.get_roster.bind(this, callback));
    this.router.send(new xmpp.Iq({id:id,type:'get'})
        .c("query", {xmlns:NS.roster}).up());

};

proto.getDelimiter = function (callback) {
    var id = util.id("roster:delimiter");
    var xpath = "self::iq[@type=result and @id='"+id+"']/priv:query/del:roster";
    this.router.request(xpath, {priv:NS.private,del:NS.delimiter}, callback);
    this.router.send(new xmpp.Iq({id:id,type:'get'})
        .c("query", {xmlns:NS.private})
        .c("roster",{xmlns:NS.delimiter})
        .up().up());
};

proto.subscribe = function(jid, message) {
    var pres = new xmpp.Presence({to:jid, type:'subscribe'});
    if (message && message != "") pres.c("status").t(message);
    this.router.send(pres);
};

proto.unsubscribe = function(jid, message) {
    var pres = new xmpp.Presence({to:jid, type:'unsubscribe'});
    if (message && message != "") pres.c("status").t(message);
    this.router.send(pres);
};

proto.authorize = function(jid, message) {
    var pres = new xmpp.Presence({to:jid, type:'subscribed'});
    if (message && message != "") pres.c("status").t(message);
    this.router.send(pres);
};

proto.unauthorize = function(jid, message) {
    var pres = new xmpp.Presence({to:jid, type:'unsubscribed'});
    if (message && message != "") pres.c("status").t(message);
    this.router.send(pres);
};


proto.get_roster = function (callback, err, stanza, items) {
    if (err || !items.length) return this.emit('error', err, res);
    var needdelimiter = false;
    items = items.map(function (item) {
        var groups = item.getChildren("group").map(function (group) {
            return group && group.getText ? group.getText() : "";
        });
        needdelimiter = needdelimiter || groups.length;
        return {
            subscription:item.attrs.subscription,
            jid:item.attrs.jid,
            ask:item.attrs.ask,
            groups:groups,
        };
    });
    if (!needdelimiter) return callback(items);
    this.getDelimiter(function (err, stanza, match) {
        if (err || !match.length) return callback(items);
        var delimiter = match[0].getText();
        return callback(items.map(function (item) {
            item.groups = item.groups.map(function (path) {
                return delimiter ? path.split(delimiter) : [path];
            });
            return item;
        }));

    });
};

proto.update_items = function (stanza, match) {
    console.log("update_items", stanza.toString(), match.toString());
};

proto.update_presence = function (stanza) {
    console.log("update_presence", stanza.toString());
};

