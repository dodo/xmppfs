var fs = require('fs');
var Path = require('path');
var EventEmitter = require('events').EventEmitter;

var inherits = require('inherits');
var extend = require('extend');
var trim = require('trim');

var BufferStream = require('bufferstream');
var xmpp = require('node-xmpp');
var f4js = require('fuse4js');

var mode = require('./mode');
var Router = require('./router').Router;

var options = {
    mount:"/tmp/mnt/user@domain",
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
    Object.keys(this.children).forEach(function (k) {
        this.children[k].parent = this;
    }.bind(this));
}

Directory.prototype.open = function (flags, callback) {
    callback(0);
};

Directory.prototype.read = function (offset, len, buf, fd, callback) {
    callback(-21); // EISDIR
};

Directory.prototype.getattr = function (callback) {
    callback(0, extend({mode:mode("dr--r--r--")}, this.stats));
};

Directory.prototype.readdir = function (callback) {
    callback(0, Object.keys(this.children || {}));
};


inherits(File, Node);
function File(name, content) {
    File.super.call(this, name);
    this.content = new BufferStream({size:'flexible'});
    if (content) this.content.write(content);
}

File.prototype.open = function (flags, callback) {
//     console.log(this.name, convertOpenFlags(flags))
    callback(0);
};

File.prototype.getattr = function (callback) {
    callback(0, extend({
        mode:mode("-rw-rw-rw-"),
        size:this.content.length,
    }, this.stats));
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


inherits(State, Node);
function State(name, defaultvalue) {
    State.super.call(this, name);
    this.content = defaultvalue || "offline";
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

var root = new Directory("");
root.mkdir = function (name, mode, callback) {
    var jid = new xmpp.JID(name);
    console.log("create new jid " + jid);
    var node = new Directory(name, {
        password: new File("password", "secret"),
        resource: new File("resource", jid.resource),
        messages: new File("messages"),
        presence: new File("presence"),
        state:    new State("state"),
        iqs:      new File("iq"),
    });
    node.jid = jid;
    node.parent = this;
    this.children[name] = node;
    node.children.state.on('state', function (state) {
        if (state === "offline") {
            if (node.client) {
                console.log("disconnect client %s …", node.jid.toString());
                node.client.end();
                delete node.client;
            }
            return;
        }
        if (node.client) return;
        node.jid.setResource(node.children.resource.content.toString('utf8'));
        console.log("connect client %s …", node.jid.toString());
        var client = node.client = new xmpp.Client({jid:node.jid,
            password:node.children.password.content.toString('utf8')});
        client.router = new Router();
        client.router.on('error', console.error.bind(console));
        client.on('stanza', client.router.onstanza);

        client.on('online', function  () {
            console.log("client %s online.", node.jid.toString());
            node.children.resource.content.reset();
            node.children.resource.content.write(node.jid.resource || "");
            client.send(new xmpp.Element('presence', { }).
                c('show').t('chat').up().
                c('status').t('dodo is using this for tests')
            );
        });
        client.on('close', function () {
            console.log("client %s offline.", node.jid.toString());
            node.client = null;
        });
        client.router.match("self::message", function (stanza) {
            var message = stanza.getChildText('body');
            if (message)
                node.children.messages.content.write(message + "\n");
        });
        client.router.match("self::presence", function (stanza) {
            node.children.presence.content.write(stanza.toString() + "\n");
        });
        client.router.match("self::iq", function (stanza) {
            node.children.iqs.content.write(stanza.toString() + "\n");
        });

    });
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

function delegate(event, path, args, err) {
    var node = lookup(path);
//     console.log("NODE", event, path, node && node.name, args);
    if (node && node[event])
        return node[event].apply(node, args);
    else args[args.length - 1](typeof(err) === 'undefined' ? -2 : err);
}


var handlers = {
    getattr: function (path, callback) {
        delegate("getattr", path, [callback]);
    },

    readdir: function (path, callback) {
        delegate("readdir", path, [callback], -20); // ENOTDIR
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
    if (process.argv.length > 2)  options.dir = process.argv[2];
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