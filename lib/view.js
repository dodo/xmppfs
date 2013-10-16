var __slice = [].slice;
var JID = require('node-xmpp').JID;
var extend = require('extend');
var fs = require('../fs');
var util = require('../util');
var model = require('./model');


var defaultcallback = function fallback(event, x, args, err) { var node = x.node;
    if (node && node[event])
         return node[event].apply(x.node, args.concat([x.contact]));
    else return args.pop()(err);
};

function readdir(opts, getchildren, event, x, args, err) { var node = x.node;
    if (!(node instanceof fs.Directory))
        return defaultcallback.apply(this, __slice.call(2, arguments));
    node.readdir.apply(extend(opts, {
        stats:node.stats,
        children: getchildren(node),
    }), args.concat([x.contact]));
}

function mkdir(callback, event, x, args, err) {
    if (!(x.node instanceof fs.Directory))
        return defaultcallback.apply(this, __slice.call(1, arguments));
    var jid = new JID(args[0]);
    var barejid = jid.bare().toString();
    var account = x.contact.account;
    x.node.mkdir(barejid, args[1], function (err) {
        if (err === fs.E.OK)
            callback(account, x.node.children[barejid], jid, barejid);
        args[2](err);
    });
};

function rmdir(callback, event, x, args, err) {
    if (!(x.node instanceof fs.Directory))
        return defaultcallback.apply(this, __slice.call(1, arguments));
    var barejid = new JID(args[0]).bare().toString();
    callback(x.node, x.node.children[barejid], barejid);
    x.node.rmdir.apply(x.node, args);
};

exports.root = function root(event, x, args, err) {
    switch(event) {
        case "readdir":
            readdir.apply(this, [{ignore_hidden:true}, function (node) {
                return util.mapObject(node.children,  function (name, child) {
                    if (name === "photos" && child.hidden) name = "." + name;
                    return [name, child];
                });
            }].concat(__slice.call(arguments)));
            break;
        default:
            defaultcallback.apply(this, __slice.call(arguments));
            break;
    }
};

exports.contact = function contact(event, x, args, err) {
    switch(event) {
        case "readdir":
            readdir.apply(this, [{}, function (node) {
                return extend(util.filterObject(node.children, function (name, child) {
                    return !child.model || !(child.model instanceof model.Roster);
                }));
            }].concat(__slice.call(arguments)));
            break;
        default:
            defaultcallback.apply(this, __slice.call(arguments));
            break;
    }
};

exports.account = function account(event, x, args, err) {
    switch(event) {
        case "readdir":
            readdir.apply(this, [{}, function (node) {
                return util.filterObject(node.children, function (name, child) {
                    return !child.model || !(child.model instanceof model.Resource);
                });
            }].concat(__slice.call(arguments)));
            break;
        case "mkdir":
            mkdir.apply(this, [function (account, node, jid, barejid) {
                account.node.add(
                    barejid,
                    account.add(jid, node).contact.node,
                    'overwrite');
            }].concat(__slice.call(arguments)));
            break;
        case "rmdir":
            rmdir.apply(this, [function (node, child, barejid) {
                if (child) { // replace with dummy
                    node.children[barejid] = null;
                    node.add(barejid, new fs.Directory()).protected = false;
                }
            }].concat(__slice.call(arguments)));
            break;
        default:
            defaultcallback.apply(this, __slice.call(arguments));
            break;
    }
};

exports.roster = function roster(event, x, args, err) {
    switch(event) {
        case "readdir":
            readdir.apply(this, [{}, function (node) {
                return util.filterObject(node.children, function (name, child) {
                    return !child.model || (child.model instanceof model.Contact);
                });
            }].concat(__slice.call(arguments)));
            break;
        case "mkdir":
            mkdir.apply(this, [function (account, node, jid) {
                account.client.subscribe(account.add(jid, node).get('jid'));
            }].concat(__slice.call(arguments)));
            break;
//         case "rmdir":
//             rmdir.apply(this, [function (node, child, barejid) {
//                 if (child) { // replace with dummy
//                     node.children[barejid] = null;
//                     node.add(barejid, new fs.Directory()).protected = false;
//                 }
//             }].concat(__slice.call(arguments)));
//             break;
        default:
            defaultcallback.apply(this, __slice.call(arguments));
            break;
    }
};

exports.resource = function resource(event, x, args, err) {
    switch(event) {
        case "readdir":
            readdir.apply(this, [{}, function (node) {
                return util.filterObject(node.children, function (name, child) {
                    return !child.model || !(child.model instanceof model.Roster);
                });
            }].concat(__slice.call(arguments)));
            break;
        default:
            defaultcallback.apply(this, __slice.call(arguments));
            break;
    }
};

exports.contacts = defaultcallback;

exports.group = defaultcallback;

