var xmpp = require('node-xmpp');
function ID(aPrefix) {
    return (aPrefix || '') + Date.now() + Math.random();
};
var NS = {
    ping: 'urn:xmpp:ping',
};

exports.Ping = Ping;
function Ping(router, disco) {
    this.router = router;
    router.match("self::iq/urn:ping", {urn:NS.ping}, this.pong.bind(this));
    if (disco) disco.addFeature(NS.ping);
};
Ping.NS = NS;
var proto = Ping.prototype;

proto.ping = function (to, callback) {
    var id = ID("ping");
    this.router.request("self::iq[@id='" + id + "']", callback);
    this.router.send(new xmpp.Iq({to:to,id:id,type:'get'})
        .c("ping", {xmlns:NS.ping}).up());
};

proto.pong = function (stanza) {
    this.router.emit('ping', stanza);
    this.router.send(new xmpp.Iq({
        to:stanza.attrs.from,
        id:stanza.attrs.id,
        type:'result',
    }));
};
