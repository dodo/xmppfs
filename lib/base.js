var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');

exports.Model = Model;
inherits(Model, EventEmitter);
function Model(attributes) {
    Model.super.call(this);
    this.attributes = attributes || {};
    console.log("create", this.constructor.name);
}

Model.prototype.get = function (name) {
    return this.attributes[name];
};

Model.prototype.set = function (name, value) {
    var old = this.attributes[name];
    if (old !== value) {
        this.emit('change', name, value, old);
        this.emit('change '+name, value, old, name);

    }
    return this.attributes[name] = value;
};
