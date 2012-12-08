var Path = require('path');
var EventEmitter = require('events').EventEmitter;
var BufferStream = require('bufferstream');
var inherits = require('inherits');
var extend = require('extend');
var trim = require('trim');
var mode = require('./mode');


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


exports.Node = Node;
inherits(Node, EventEmitter);
Node.prototype.prefix = "-";
function Node(name) {
    Node.super.call(this);
    var now = new Date();
    this.name = name;
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
function Directory(name, children) {
    Directory.super.call(this, name);
    this.children = children || {};
    this.stats.size = 4096;
    Object.keys(this.children).forEach(function (k) {
        this.children[k].parent = this;
    }.bind(this));
    this.setMode("r--r--r--");
}

Directory.prototype.open = function (flags, callback) {
    callback(0);
};

Directory.prototype.read = function (offset, len, buf, fd, callback) {
    callback(-21); // EISDIR
};

Directory.prototype.getattr = function (callback) {
    callback(0, extend({}, this.stats));
};

Directory.prototype.readdir = function (callback) {
    callback(0, Object.keys(this.children || {}));
};


exports.File = File;
inherits(File, Node);
function File(name, content) {
    File.super.call(this, name);
    this.content = new BufferStream({size:'flexible'});
    if (content) this.content.write(content);
    this.setMode("rw-rw-rw-");
}

File.prototype.open = function (flags, callback) {
//     console.log(this.name, convertOpenFlags(flags))
    callback(0);
};

File.prototype.getattr = function (callback) {
    callback(0, extend({size:this.content.length}, this.stats));
};

File.prototype.read = function (offset, len, buf, fd, callback) {
    var err = 0;
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
    callback(0);
};


exports.State = State;
inherits(State, Node);
function State(name, defaultvalue) {
    State.super.call(this, name);
    this.content = defaultvalue || "offline";
    this.setMode("rw-rw-rw-");
}
State.prototype.open     = File.prototype.open;
State.prototype.getattr  = File.prototype.getattr;
State.prototype.truncate = function (offset, callback) {
    callback(0); // do not truncate state. never.
};

State.prototype.read  = function (offset, len, buf, fd, callback) {
    callback(buf.write(this.content, 0, this.content.length));
};

State.prototype.write = function (offset, len, buf, fd, callback) {
    var err = 0;
    var data = trim(buf.toString('utf8')); // read the new data
    if (data != "offline" && data != "online") {
        err = -129; // EKEYREJECTED
    } else {
        err = len;
        this.content = data;
        this.emit('state', data);
    }
    callback(err);
};

// -----------------------------------------------------------------------------

function lookup(root, path) {
    if (path === "/")
        return root;
    var parts = path.split('/');
    var depth = 0;
    var name = parts[++depth];
    var node = root.children[name];
    while(node && (depth + 1 < parts.length)) {
        name = parts[++depth];
        if (!node.children) return;
        node = node.children[name];
    }
    return node;
}

function scheduler(event, path, args, err) {
    var node = lookup(this, path);
//     console.log("NODE", event, path, node && node.name, args);
    if (node && node[event])
        return node[event].apply(node, args);
    else args[args.length - 1](typeof(err) === 'undefined' ? -2 : err);
}


exports.createRouter = createRouter;
function createRouter(root, options) {
    var delegate = scheduler.bind(root);
    return {
    getattr: function (path, callback) {
        delegate("getattr", path, [callback]);
    },

    readdir: function (path, callback) {
        delegate("readdir", path, [callback], -20); // ENOTDIR
    },

    open: function (path, flags, callback) {
        delegate("open", path, [flags, callback]);
    },

    poll: function (path, fd, callback) {
        console.error("POLL", path)
        delegate("poll", path, [fd, callback], 0);
    },

    read: function (path, offset, len, buf, fd, callback) {
        delegate("read", path, [offset, len, buf, fd, callback]);
    },

    write: function (path, offset, len, buf, fd, callback) {
        delegate("write", path, [offset, len, buf, fd, callback]);
    },

    create: function (path, mode, callback) {
        delegate("create", Path.dirname(path), [Path.basename(path), mode, callback]);
    },
    truncate: function (path, offset, callback) {
        delegate("truncate", path, [offset, callback]);
    },

    readlink: function (path, callback) {
        delegate("readlink", path, [callback]);
    },

    unlink: function (path, callback) {
        delegate("unline", path, [callback], -1);
    },

    rename: function (src, dst, callback) {
        delegate("rename", src, [src, dst, callback]);
    },

    mkdir: function (path, mode, callback) {
        delegate("mkdir", Path.dirname(path), [Path.basename(path), mode, callback]);
    },

    rmdir: function (path, callback) {
        delegate("rmdir", path, [callback]);
    },

    flush: function (path, fd, callback) {
        delegate("flush", path, [fd, callback], 0);
    },

    release: function (path, fd, callback) {
        delegate("release", path, [fd, callback], 0);
    },

    init: function (callback) {
        console.log("File system started at " + options.mount);
        console.log("To stop it, type this in another shell: fusermount -u " + options.mount);
        callback();
    },

    destroy: function (callback) {
        console.log("File system stopped");
        callback();
    },

}};
