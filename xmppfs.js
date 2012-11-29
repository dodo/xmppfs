var fs = require('fs');
var Path = require('path');
var EventEmitter = require('events').EventEmitter;

var inherits = require('inherits');
var extend = require('extend');
var trim = require('trim');

var xmpp = require('node-xmpp');
var f4js = require('fuse4js');

var options = {
    mount:"/tmp/mnt/user@domain",
    jid:  "user@domain",
    dir:  "/tmp/mnt",
//     debug: true,
};

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


inherits(Node, EventEmitter);
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
}


inherits(Directory, Node);
function Directory(name, children) {
    Directory.super.call(this, name);
    this.children = children || {};
    this.stats.size = 4096;
}

Directory.prototype.open = function (flags, callback) {
    callback(0);
};

Directory.prototype.getattr = function (callback) {
    callback(0, extend({mode:040444}, this.stats));
};

Directory.prototype.readdir = function (callback) {
    callback(0, Object.keys(this.children || {}));
};


inherits(File, Node);
function File(name, content) {
    File.super.call(this, name);
    this.content = content;
}

File.prototype.readdir = function (callback) {
    callback(-22);
};

File.prototype.open = function (flags, callback) {
    console.log(this.name, convertOpenFlags(flags))
    callback(0);
};

File.prototype.getattr = function (callback) {
    var len = this.content && this.content.length || 0;
    callback(0, extend({mode:0100666, size:len}, this.stats));
};

File.prototype.read = function (offset, len, buf, fd, callback) {
    var maxBytes, data, err = 0;
    if (this.content && offset < this.content.length) {
        maxBytes = this.content.length - offset;
        if (len > maxBytes) {
            len = maxBytes;
        }
        data = this.content.substring(offset, len);
        buf.write(data, 0, len, 'utf8');
        err = len;
    }
    callback(err);
};

File.prototype.write = function (offset, len, buf, fd, callback) {
    var beginning, ending = "", blank = "", numBlankChars, err = 0;
    var data = buf.toString('utf8'); // read the new data
    this.content = this.content || "";
    if (offset < this.content.length) {
        beginning = this.content.substring(0, offset);
        if (offset + data.length < this.content.length) {
            ending = this.content.substring(offset + data.length, this.content.length);
        }
    } else {
        beginning = this.content;
        numBlankChars = offset - this.content.length;
        while (numBlankChars--) blank += " ";
    }
    this.content = beginning + blank + data + ending;
    err = data.length;
    callback(err);
};

File.prototype.truncate = function (offset, callback) {
    this.content = this.content || "";
    if (offset < this.content.length) {
        this.content = this.content.substring(0, offset);
    } else {
        var numBlankChars = offset - this.content.length;
        while (numBlankChars--) this.content += " ";
    }
    callback(0);
};


inherits(State, File);
function State(name, defaultvalue) {
    State.super.call(this, name, defaultvalue || "offline");
}

State.prototype.truncate = function (offset, callback) {
    callback(0); // do not truncate state. never.
};

State.prototype.write = function (offset, len, buf, fd, callback) {
    var old_state = ""+this.content;
    var _write_file = State.super.prototype.write;
    return _write_file.call(this, offset, len, buf, fd, function (err) {
        this.content = trim(this.content);
        if (this.content != "offline" && this.content != "online") {
            this.content = old_state;
            err = -129; // EKEYREJECTED
        } else {
            this.emit('state', this.content);
        }
        callback(err);
    }.bind(this));
};


var root = new Directory("");
root.mkdir = function (name, mode, callback) {
    var jid = new xmpp.JID(name);
    console.log("create new jid " + jid);
    var node = new Directory(name, {
        password: new File("password", "secret"),
        resource: new File("resource"),
        messages: new File("messages"),
        state:    new State("state"),
    });
    node.jid = jid;
    this.children[name] = node;
    node.children.state.on('state', function (state) {console.error("STATE", state)});
    callback(0);
};

// -----------------------------------------------------------------------------

function lookup(path) {
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

function delegate(event, path, args) {
    var node = lookup(path);
//     console.log("NODE", event, path, node && node.name, args);
    if (node && node[event])
        return node[event].apply(node, args);
    else args[args.length - 1](-2);
}


var handlers = {
    getattr: function (path, callback) {
        delegate("getattr", path, [callback]);
    },

    readdir: function (path, callback) {
        delegate("readdir", path, [callback]);
    },

    open: function (path, flags, callback) {
        delegate("open", path, [flags, callback]);
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
        var err = -1; // -EPERM assume failure
        callback(err);
    },

    rename: function (src, dst, callback) {
        var err = -2; // -ENOENT assume failure
        callback(err);
    },

    mkdir: function (path, mode, callback) {
        delegate("mkdir", Path.dirname(path), [Path.basename(path), mode, callback]);
    },

    rmdir: function (path, callback) {
        delegate("rmdir", path, [callback]);
    },

    flush: function (path, fd, callback) {
        callback(0, fd);
    },

    release: function (path, fd, callback) {
        callback(0, fd);
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

};

function unmount(callback) {
    console.log("unmount.");
    var cmd = "fusermount -u " + options.mount;
    require('child_process').exec(cmd, function (err) {
        if (err) console.error(""+err);
        callback();
    });
}



function main() {
    if (process.argv.length < 3) {
        console.log("Usage: %s mount jid", Path.basename(process.argv[1]));
        return process.exit(-1);
    }
    if (process.argv.length > 3)  options.dir = process.argv[2];
    if (process.argv.length > 4)  options.jid = process.argv[3];
    options.mount = Path.normalize(options.dir);

    process.on('SIGINT', function() {
        unmount(function() { process.exit(0); });
    });

    try {
        f4js.start(options.mount, handlers, options.debug);
    } catch (err) {
        console.log("Exception when starting file system: " + err);
    }
}

main();