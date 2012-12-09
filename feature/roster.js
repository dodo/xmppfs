var xmpp = require('node-xmpp');
var util = require('./util');

var NS = {
    roster: 'jabber:iq:roster',
};

exports.Roster = Roster;
function Roster(router, disco) {
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
                        {roster:NS.roster}, callback);
    this.router.send(new xmpp.Iq({id:id,type:'get'})
        .c("query", {xmlns:NS.roster}).up());

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


proto.update_items = function (stanza, match) {
    console.log("update_items", stanza.toString(), match.toString());
};

proto.update_presence = function (stanza) {
    console.log("update_presence", stanza.toString());
};

