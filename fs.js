var Path = require('path');
var EventEmitter = require('events').EventEmitter;
var BufferStream = require('bufferstream');
var inherits = require('inherits');
var extend = require('extend');
var trim = require('trim');
var mode = require('./mode');
var __slice = [].slice;


var E = exports.E = {OK:0,EPERM:1,ENOENT:2,ENOTDIR:20,EISDIR:21,EKEYREJECTED:129};


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
    Node.super.call(this);
    var now = new Date();
    this.name = this.name || "";
    this.hidden = false;
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
};


exports.Directory = Directory;
inherits(Directory, Node);
Directory.prototype.prefix = "d";
function Directory(children) {
    Directory.super.call(this);
    this.children = children || {};
    this.stats.size = 4096;
    Object.keys(this.children).forEach(this.add.bind(this));
    this.setMode("r--r--r--");
}

Directory.prototype.add = function (name, child) {
    if (typeof(name) !== 'string') {child = name; name = undefined;}
    if (typeof(child) !== 'object') child = null;
    if (!name && child) name = child.name;
    if (!child && name) child = this.children[name];
    if (!child) return console.error("no child!");
    if (!name) return console.error("no name!");
    this.children[name] = child;
    if (!child.parent) child.parent = this;
    if (!child.name) child.name = name;
    return child;
}

Directory.prototype.open = function (flags, callback) {
    callback(E.OK);
};

Directory.prototype.read = function (offset, len, buf, fd, callback) {
    callback(-E.EISDIR);
};

Directory.prototype.getattr = function (callback) {
    callback(E.OK, extend({}, this.stats));
};

Directory.prototype.readdir = function (callback) {
    callback(E.OK, Object.keys(this.children).map(function (name) {
        if (this.children[name].hidden) name = "." + name;
        return name;
    }.bind(this)));
};


exports.File = File;
inherits(File, Node);
function File(content) {
    File.super.call(this);
    this.content = new BufferStream({size:'flexible'});
    if (content) this.content.write(content);
    this.setMode("rw-rw-rw-");
}

File.prototype.open = function (flags, callback) {
//     console.log(this.name, convertOpenFlags(flags))
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
    callback(len);
};

File.prototype.truncate = function (offset, callback) {
    this.content.reset();
    callback(E.OK);
};


exports.State = State;
inherits(State, Node);
function State(options, defaultvalue) {
    State.super.call(this);
    this.options = options || [];
    this.content = defaultvalue || this.options[0];
    this.setMode("rw-rw-rw-");
}
State.prototype.setState = function (state) {
    if (this.content === state) return;
    this.content = state;
    this.emit('state', state);
};

State.prototype.open     = File.prototype.open;
State.prototype.getattr  = File.prototype.getattr;
State.prototype.truncate = function (offset, callback) {
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
        this.setState(data);
    }
    callback(err);
};

exports.DesktopEntry = DesktopEntry;
inherits(DesktopEntry, File);
function DesktopEntry(options) {
    this.name = ".directory";
    this.options = options || {};
    DesktopEntry.super.call(this, this.toString('content'));
}

DesktopEntry.prototype.toString = function (mode) {
    if (mode !== 'content')
        return DesktopEntry.super.toString.apply(this, __slice.call(arguments));
    return ["[Desktop Entry]"].concat(
      Object.keys(this.options).map(function (key) {
        return key + "=" + this.options[key];
    }.bind(this))).join("\n") + "\n";
}

DesktopEntry.prototype.setOptions = function (options) {
    Object.keys(options || {}).forEach(function (key) {
        if (options[key] === undefined || options[key] === null)
            delete options[key];
        else this.options[key] = options[key];
    }.bind(this));
    this.content.reset();
    this.content.write(this.toString('content'));
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

function lookup(root, path) {
    if (path === "/")
        return root;
    var parts = path.split('/');
    var depth = 0;
    var name = parts[++depth];
    var node = decodeHidden(root.children, name);
    while(node && (depth + 1 < parts.length)) {
        name = parts[++depth];
        if (!node.children) return;
        node = decodeHidden(node.children, name);
    }
    return node;
}

function scheduler(event, path, args, err) {
    var node = lookup(this, path);
//     console.log("NODE", event, path, node && node.name, args);
    if (node && node[event])
         return node[event].apply(node, args);
    else return args.pop()(err);
}

exports.createRouter = createRouter;
function createRouter(root, options) {
    var delegate = scheduler.bind(root);
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

    };

    pass.call(-E.ENOTDIR, "readdir");
    pass.call(-E.EPERM  , "unlink");

    var passthrough = ["getattr","open","read","write","truncate","readlink","rename","rmdir"];
    passthrough.map(pass.bind(-E.ENOENT));
    var passsuccess = ["poll","flush","release"];
    passsuccess.map(pass.bind(E.OK));
    var passpath = ["create","mkdir"];
    passpath.map(function (method) {
        handlers[method] = function (path) {
            var args = __slice.call(arguments, 1);
            args.unshift(Path.basename(path));
            delegate(method, Path.dirname(path), args, -E.ENOENT);
        };
    });

    return handlers;
}
