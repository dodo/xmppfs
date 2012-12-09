var xmpp = require('node-xmpp');
var util = require('./util');

var NS = {
    vcard: 'vcard-temp',
    update: 'vcard-temp:x:update',
};

exports.VCard = VCard;
function VCard(router) {
    this.router = router;
};
VCard.NS = NS;
var proto = VCard.prototype;

proto.get = function (to, callback) {
    if (!callback) {callback = to; to = undefined;}
    var id = util.id("vcard:get");
    if (to) to = (new xmpp.JID(to)).bare();
    this.router.request("self::iq[@id='" + id + "']/vc:vCard/child::*",
                        {vc:NS.vcard}, callback);
    this.router.send(new xmpp.Iq({to:to,id:id,type:'get',from:this.router.connection.jid})
        .c("vCard", {xmlns:NS.vcard}).up());
};
proto.set = function (to, vcard, callback) {
    if (!callback) {callback = vcard; vcard = to; to = undefined;}
    if (!callback) {callback = vcard; vcard = undefined;}
    var id = util.id("vcard:set");
    if (to) to = (new xmpp.JID(to)).bare();
    this.router.request("self::iq[@id='" + id + "']", callback);
    var iq = new xmpp.Iq({to:to,id:id,type:'set',from:this.router.connection.jid})
        .c("vCard", {xmlns:NS.vcard}).up();
    if (vcard) iq.cnode(vcard);
    this.router.send(iq);
};

proto.presence = function (stanza) {
    this.router.emit('presence', stanza);
};
