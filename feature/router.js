var EventEmitter = require('events').EventEmitter;

var inherits = require('inherits');
var ltxXPath = require('ltx-xpath').XPath;


exports.Router = Router;
inherits(Router, EventEmitter);
function Router(connection, timeout) {
    this.connection = connection;
    this.timeout = timeout || 1000;
    this.xpath = new ltxXPath();
    this.onstanza = this.onstanza.bind(this);
}

Router.prototype.match = function (xpath, namespaces, callback) {
    this.xpath.on(xpath, namespaces, callback);
    return this;
};

Router.prototype.send = function (stanza) {
    this.connection.send(stanza);
    return this;
};

Router.prototype.request = function (xpath, namespaces, callback) {
    // TODO autogenerate xpath from stanza to be send
    if (!callback) {
        callback = namespaces;
        namespaces = undefined;
    }
    var timeout = setTimeout(function () {
        this.xpath.removeListener(xpath, response);
        if (callback) callback("timeout");
    }.bind(this), this.timeout);
    this.xpath.once(xpath, namespaces, function response(stanza) {
        clearTimeout(timeout);
        if (callback) callback(null, stanza);
    });
    return this;
};

Router.prototype.onstanza = function (stanza) {
    // dispatch stanza to callback or handle error
    if (!this.xpath.match(stanza)) {
        this.emit('error', "unhandled stanza " + stanza, stanza);
    }
};

