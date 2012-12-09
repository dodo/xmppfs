var xmpp = require('node-xmpp');

exports.Presence = Presence;
function Presence(router) {
    this.router = router;
    router.match("self::presence", this.presence.bind(this));
};

var proto = Presence.prototype;

proto.send = function (to, opts) {
    if (!opts) {opts = to;to = undefined;}
    if (!to && opts) to = opts.to;
    var attrs = to ? {to:to} : null;
    if (attrs && opts && opts.type) attrs.type = opts.type;
    var presence = new xmpp.Presence(attrs);
    if (opts) {
        ["status", "priority", "show"].forEach(function (key) {
            if (opts[key]) presence.c(key).t(opts[key]);
        });
        if (opts.payload) presence.t(opts.payload);
    }
    this.router.send(presence);
    return this;
};

proto.presence = function (stanza) {
    this.router.emit('presence', stanza);
};
