var __slice = [].slice;
var xmpp = require('node-xmpp');
var util = require('./util');

var NS = {
    'disco#info': "http://jabber.org/protocol/disco#info",
    'disco#items': "http://jabber.org/protocol/disco#items",
};

var identities = [{category: 'client', name: 'xmppfs', type:'filesystem'}];

var features = [NS['disco#info']];

exports.Disco = Disco;
function Disco(router) {
    this.router = router;
    this.identities = identities.slice();
    this.features = features.slice();
    this.router.match("self::iq[@type=get]/info:query",
                        {info:NS['disco#info']},
                        this.get_info.bind(this));
};
Disco.identities = identities;
Disco.features = features;
Disco.NS = NS;
var proto = Disco.prototype;

proto.addFeature = function (/* features… */) {
    this.features.splice.apply(this.features,
        [this.features.length, 0].concat(__slice.call(arguments)));
    return this;
};

proto.addIdentity = function (/* identities */) {
    this.identities.splice.apply(this.identities,
        [this.identities.length, 0].concat(__slice.call(arguments)));
    return this;
};

proto.info = function (to, callback) {
    var id = util.id("info");
    var from = this.router.connection.jid;
    var xpath = "self::iq[@type=result and @id='" + id + "']/info:query";
    this.router.request(xpath, {info:NS['disco#info']}, callback);
    this.router.send(new xmpp.Iq({from:from,to:to,id:id,type:'get'})
        .c("query", {xmlns:NS['disco#info']}).up());
};

proto.get_info = function (stanza, match) {
    this.router.emit('info', stanza, match);
    var query = new xmpp.Iq({
        from:stanza.attrs.to,
        to:stanza.attrs.from,
        id:stanza.attrs.id,
        type:'result',
    }).c("query", {xmlns:NS['disco#info']});
    for (var i = 0, length = this.identities.length; i < length; i++) {
        query.c("identity", this.identities[i]);
    }
    for (var i = 0, length = this.features.length; i < length; i++) {
        query.c("feature", {var:this.features[i]});
    }
    this.router.send(query.up());
    return this;
};

