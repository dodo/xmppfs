var Path = require('path');
var EventEmitter = require('events').EventEmitter;
var BufferStream = require('bufferstream');
var inherits = require('util').inherits;
var extend = require('extend');
var trim = require('trim');
var mode = require('./mode');
var util = require('./util');
var __slice = [].slice;


var E = exports.E = {OK:0,EPERM:1,ENOENT:2,EACCES:13,EEXIST:17,ENOTDIR:20,
                     EISDIR:21,ENOTEMPTY:39,EKEYREJECTED:129};


exports.convertOpenFlags = convertOpenFlags;
function convertOpenFlags(openFlags) {
  switch (openFlags & 3) {
  case 0:
    return 'r';              // O_RDONLY
  case 1:
    return 'w';              // O_WRONLY
  case 2:
    return 'r+';             // O_RDWR
  }
}

exports.join = join;
function join(node) {return node ? (join(node.parent) + "/" + node.name) : ""};


exports.Node = Node;
inherits(Node, EventEmitter);
Node.prototype.prefix = "-";
function Node() {
    Node.super_.call(this);
    var now = new Date();
    this.name = this.name || "";
    this.hidden = false;
    this.protected = true;
    this.stats = {
        uid:process.getuid(),
        gid:process.getgid(),
        mtime:now,
        atime:now,
        ctime:now,
    };
    this.setMode("---------");
}

Node.prototype.setMode = function (newmode) {
    this.stats.mode = mode(this.prefix + newmode);
    this.stats.mtime = new Date();
    return this;
};


exports.Directory = Directory;
inherits(Directory, Node);
Directory.prototype.prefix = "d";
function Directory(children) {
    Directory.super_.call(this);
    this.ignore_hidden = false;
    this.children = children || {};
    this.stats.size = 4096;
    Object.keys(this.children).forEach(this.add.bind(this));
    this.setMode("r--r--r--");
}

Directory.prototype.add = function (name, child, action) {
    if (typeof(name) !== 'string') {child = name; name = undefined;}
    if (typeof(child) !== 'object') child = null;
    if (!name && child) name = child.name;
    if (!child && name) child = this.children[name];
    if (!child) return console.error("no child!");
    if (!name) return console.error("no name!");
    if (action === 'overwrite' ||
       !this.children[name]    ||
        this.children[name].constructor !== child.constructor)
        this.children[name] = child;
    child = this.children[name];
    if (!child.parent) child.parent = this;
    if (!child.name) child.name = name;
    child.protected = true;
    return child;
};

Directory.prototype.open = function (flags, callback) {
    callback(-E.EISDIR);
};

Directory.prototype.read = function (offset, len, buf, fd, callback) {
    callback(-E.EISDIR);
};

Directory.prototype.write = function (offset, len, buf, fd, callback) {
    callback(-E.EISDIR);
};

Directory.prototype.mkdir = function (name, mode, callback) {
    if (!this.children[name]) {
        this.add(name, new Directory()).protected = false;
        callback(E.OK);
    } else callback(this.children[name].prefix==="d"?(-E.EISDIR):(-E.EEXIST));
};

Directory.prototype.rmdir = function (name, callback) {
    if (this.children[name] && this.children[name].prefix !== "d")
        return callback(-E.ENOTDIR);
    if (this.children[name] && this.children[name].children.length)
        return callback(-E.ENOTEMPTY);
    if (this.children[name] && !this.children[name].protected) {
        if (this.children[name].parent === this)
            this.children[name].parent = null;
        delete this.children[name];
        this.stats.ctime = new Date();
        callback(E.OK);
    } else callback(this.children[name] ? (-E.EACCES) : (-E.ENOENT));
};

Directory.prototype.create = function  (name, mode, callback) {
    if (!this.children[name]) {
        this.add(name, new File()).protected = false;
        this.stats.ctime = new Date();
        callback(E.OK);
    } else callback(this.children[name].prefix==="d"?(-E.EISDIR):(-E.EEXIST));
};

Directory.prototype.unlink = function (name, callback) {
    if (this.children[name] && this.children[name].prefix === "d")
        return callback(-E.EISDIR);
    if (this.children[name] && !this.children[name].protected) {
        if (this.children[name].parent === this)
            this.children[name].parent = null;
        delete this.children[name];
        this.stats.ctime = new Date();
        callback(E.OK);
    } else callback(this.children[name] ? (-E.EACCES) : (-E.ENOENT));
};

Directory.prototype.getattr = function (callback) {
    callback(E.OK, extend({}, this.stats));
};

Directory.prototype.readdir = function (callback) {
    this.stats.atime = new Date();
    if (this.ignore_hidden) return callback(E.OK, Object.keys(this.children));
    callback(E.OK, Object.keys(this.children).map(function (name) {
        if (this.children[name].hidden) name = "." + name;
        return name;
    }.bind(this)));
};


exports.File = File;
inherits(File, Node);
function File(content) {
    File.super_.call(this);
    this.content = new BufferStream({size:'flexible'});
    if (content) this.content.write(content);
    this.setMode("rw-rw-rw-");
}

File.prototype.save = function (content) {
    this.content.reset();
    this.content.write(content);
    this.emit('content', this.content);
    return this;
}

File.prototype.open = function (flags, callback) {
//     console.log(this.name, convertOpenFlags(flags))
    this.stats.atime = new Date();
    callback(E.OK);
};

File.prototype.getattr = function (callback) {
    callback(E.OK, extend({size:this.content.length}, this.stats));
};

File.prototype.read = function (offset, len, buf, fd, callback) {
    var err = E.OK;
    var clen = this.content.length;
    if (offset < clen) {
        err = Math.min(len, clen - offset);
        this.content.buffer.copy(buf.slice(0, err), 0, offset, Math.min(clen, offset + err));
    }
    callback(err);
};

File.prototype.write = function (offset, len, buf, fd, callback) {
    this.content.write(buf.slice(0, len));
    this.stats.ctime = new Date();
    if (len) this.emit('content', this.content);
    callback(len);
};

File.prototype.truncate = function (offset, callback) {
    this.stats.ctime = new Date();
    this.content.reset();
    callback(E.OK);
};


exports.State = State;
inherits(State, Node);
function State(options, defaultvalue) {
    State.super_.call(this);
    this.options = options || [];
    this.content = defaultvalue || this.options[0];
    this.setMode("rw-rw-rw-");
}
State.prototype.setState = function (state, dir) {
    if (this.content === state) return this;
    this.emit('state', state, dir || 'out');
    this.stats.ctime = new Date();
    this.content = state;
    return this;
};

State.prototype.open     = File.prototype.open;
State.prototype.getattr  = File.prototype.getattr;
State.prototype.truncate = function (offset, callback) {
    this.stats.ctime = new Date();
    callback(E.OK); // do not truncate state. never.
};

State.prototype.read  = function (offset, len, buf, fd, callback) {
    callback(buf.write(this.content, 0, this.content.length));
};

State.prototype.write = function (offset, len, buf, fd, callback) {
    var err = E.OK;
    var data = trim(buf.toString('utf8')); // read the new data
    if (this.options.indexOf(data) === -1) {
        err = -E.EKEYREJECTED;
    } else {
        err = len;
        this.setState(data, 'in');
    }
    callback(err);
};


exports.DesktopEntry = DesktopEntry;
inherits(DesktopEntry, File);
function DesktopEntry(options) {
    this.name = ".directory";
    this.options = options || {};
    DesktopEntry.super_.call(this, this.toString('content'));
}

DesktopEntry.prototype.toString = function (mode) {
    if (mode !== 'content')
        return DesktopEntry.super_.toString.apply(this, __slice.call(arguments));
    return ["[Desktop Entry]"].concat(
      Object.keys(this.options).map(function (key) {
        return key + "=" + this.options[key];
    }.bind(this))).join("\n") + "\n";
};

DesktopEntry.prototype.setOptions = function (options) {
    var newstuff = false;
    Object.keys(options || {}).forEach(function (key) {
        if (options[key] === undefined || options[key] === null)
            delete options[key];
        else {newstuff = true; this.options[key] = options[key];}
    }.bind(this));
    this.content.reset();
    this.content.write(this.toString('content'));
    if (newstuff) this.stats.ctime = new Date();
    return this;
};


exports.Chat = Chat;
inherits(Chat, File);
function Chat(client, content) {
    Chat.super_.call(this, content);
    this.client = client;
    this.log = [];
}

Chat.prototype.truncate = function () {
    this.updateContent();
    return Chat.super_.prototype.truncate.apply(this, __slice.call(arguments));
};

Chat.prototype.write = function (offset, len, buf, fd, callback) {
    if (!this.client.handle) return callback(E.OK);
    this.emit('message', this.writeOut(buf, offset).message);
    callback(len);
};

Chat.prototype.clear = function () {
    this.content.reset();
    this.log = [];
    return this;
};

Chat.prototype.out = function (entry) {
    this.content.write(""
        + util.formatDate(entry.time)
        + entry.x + " "
        + entry.message
        + "\n");
    return entry;
};

Chat.prototype.updateContent = function () {
    this.content.reset();
    this.log.forEach(this.out.bind(this));
};

Chat.prototype.writeIn = function (message) {
    var entry = {message:message, x:">", time:new Date}
    this.log.push(entry);
    this.updateContent();
    this.stats.ctime = new Date();
    return entry;
};

Chat.prototype.writeOut = function (buf, offset) {
    var entry = {message:"", x:"<", time:new Date};
    if (buf.toString().split("").some(function(c){return c.charCodeAt(0)===0})) {
        entry.message = buf.toString('base64').replace("\n","");
        this.log.push(entry);
        this.updateContent();
        this.stats.mtime = new Date();
        return entry;
    }
    var i = 0, n = 0;
    var messagelines = this.log[0] ? this.log[0].message.split("\n") : [""];
    var rawmessage = new BufferStream({size:'flexible', split:"\n"});
    rawmessage.on('split', function (line) {
        var msg = line.toString('utf8');
        if (!this.log[n] || msg.indexOf(messagelines[i]) === -1) {
            entry.message += msg + "\n";
            rawmessage.disabled = true; // dont use disable because it resets
        }
        if (++i >= messagelines.length) {
            messagelines = this.log[++n] ? this.log[n].message.split("\n") : [""];
            i = 0;
        }
    }.bind(this));
    if (offset) rawmessage.write(this.content.buffer.slice(0, offset));
    rawmessage.write(buf); // sync
    entry.message += rawmessage.toString('utf8');
    this.log.push(entry);
    this.updateContent();
    this.stats.mtime = new Date();
    return entry;
};

// -----------------------------------------------------------------------------

function decodeHidden(children, name) {
    var node = children[name];
    if (node) return node;
    if (name.charCodeAt(0) === 46 /*.*/ &&
       (node = children[name.slice(1)]) &&
        node.hidden)
        return node;
    return;
}

exports.lookup = lookup;
function lookup(root, path) {
    var p, routes = this;
    if (path === "/")
        return {params:{}, node:root, path:path, route:this, ss:"/",name:"-"};
    var parts = path.split('/');
    var params = {};
    var depth = 0;
    var name = parts[++depth];
    var node = decodeHidden(root.children, name);
    var contact = node && node.contact;
    if (routes) routes = routes[(p = util.matchUrl(routes, name)).path];
    if (routes) params = extend(params, p.params);
    var ss = "/" + (p&&p.path);
    while(node && (depth + 1 < parts.length)) {
        name = parts[++depth];
        if (node.contact) contact = node.contact;
        if (!node.children) return {contact:contact,route:routes,params:params};
        if (!(node = decodeHidden(node.children, name))) break;
        if (routes) routes = routes[(p = util.matchUrl(routes, name)).path];
        if (routes) params = extend(params, p.params);
        ss = ss + "/" + (p&&p.path);
    }
    return {
        path:parts.slice(depth-1).join("/")||"/",
        ss:ss,
        contact:contact,
        params:params,
        route:routes,
        node:node,
        name:name,
    };
}

exports.scheduler = scheduler;
function scheduler(event, path, args, err) {
    var x = lookup.call(this.routes, this.root, path);
    var node = x.node;
//     console.log("NODE", event, path, node && node.name, args);
    var task = node && node[event];
    if (task && x.route && x.route['/'])
{//console.error(path, "\n",x.ss,x.path,event,x.route['/'].name, x.name,!!x.contact)
         return x.route['/'](event, x, args, err);}
    else if (task)
         return task.apply(node, args.concat([x.contact]));
//     else if (node)
//          return node.lookup(event, x.path, contact, args, err);
    else return args.pop()(err);
}

exports.createRouter = createRouter;
function createRouter(root, routes, options) {
    var delegate = scheduler.bind({root:root, routes:routes});
    function pass(method) {
        var code = 0 + this;
        return handlers[method] = function (path) {
            delegate(method, path, __slice.call(arguments, 1), code);
        };
    }

    var handlers = {

        init: function (callback) {
            console.log("File system started at " + options.mount);
            console.log("To stop it, type this in another shell: fusermount -u " + options.mount);
            callback();
        },

        destroy: function (callback) {
            console.log("File system stopped");
            if (options.destroy) options.destroy();
            callback();
        },

        statfs: function (callback) {
            callback(0, {
                bsize: 1000000,
                frsize: 1000000,
                blocks: 1000000,
                bfree: 1000000,
                bavail: 1000000,
                files: 1000000,
                ffree: 1000000,
                favail: 1000000,
                fsid: 1000000,
                flag: 1000000,
                namemax: 1000000
            });
        },

    };

    pass.call(-E.ENOTDIR, "readdir");
    var passthrough = ["getattr","open","read","write","truncate","readlink"];
    passthrough.map(pass.bind(-E.ENOENT));
    var passsuccess = ["poll","flush","release"];
    passsuccess.map(pass.bind(E.OK));
    var passpath = ["create","mkdir","rmdir","unlink","rename"];
    passpath.map(function (method) {
        var code = method === "rmdir" ? (-E.ENOTDIR) : (-E.ENOENT);
        handlers[method] = function (path) {
            var args = __slice.call(arguments, 1);
            args.unshift(Path.basename(path));
            delegate(method, Path.dirname(path), args, code);
        };
    });

    return handlers;
}
