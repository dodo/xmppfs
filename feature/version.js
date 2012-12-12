var xmpp = require('node-xmpp');
var util = require('./util');

var NS = {
    version: 'jabber:iq:version',
};

exports.Version = Version;
function Version(router, options) {
    this.identity = {};
    this.set(options);
    this.router = router;
    router.match("self::iq[@type=get]/version:query",
                 {version:NS.version},
                 this.get_version.bind(this));
    if (options && options.disco) {
        options.disco.addIdentity(this.identity);
        options.disco.addFeature(NS.version);
    }
};
Version.NS = NS;
var proto = Version.prototype;

proto.set = function (options) {
    options = options || {};
    var id = this.identity;
    ;["category","name"].forEach(function (k) { id[k] = options[k] || "" });
    this.version = options.version || "";
    id.type = options.type;
    this.os = options.os;

};

proto.version = function (to, callback) {
    var id = util.id("version");
    var from = this.router.connection.jid;
    var xpath = "self::iq[@type=result and @id='"+id+"']/version:query/child::*";
    this.router.request(xpath, {version:NS.version}, callback);
    this.router.send(new xmpp.Iq({from:from,to:to,id:id,type:'get'})
        .c("query", {xmlns:NS.version}).up());
};

proto.get_version = function (stanza, match) {
    this.router.emit('version', stanza, match);
    var query = new xmpp.Iq({
        to:stanza.attrs.from,
        id:stanza.attrs.id,
        type:'result',
    }).c("query", {xmlns:NS.version});
    query.c("version").t(this.version);
    query.c("name").t(this.identity.name);
    if (this.os) query.c("os").t(this.os);
    this.router.send(query.up());
};
