var fs = require('fs');
var Path = require('path');

var extend = require('extend');
var xmpp = require('node-xmpp');
var f4js = require('fuse4js');

var options = {
    mount:"/tmp/mnt/user@domain",
    jid:  "user@domain",
    dir:  "/tmp/mnt",
    debug: false,
};


var std = {
    dir: {
        open: function (flags, callback) {
            callback(0);
        },
        getattr: function (callback) {
            callback(0, {
                size: 4096,
                mode: 040444,

            });
        },
        readdir: function (callback) {
            callback(0, Object.keys(this.children || {}));
        },
    },
    file: {
        open: function (flags, callback) {
            callback(0);
        },
        getattr: function (callback) {
            callback(0, {
                size: this.content && this.content.length ? this.content.length : 0,
                mode: 010444,
            });
        },

    },
    // helper
    path: function (node) {
        var path = node.name;
        while ((node = node.parent)) path = Path.join(node.name, path);
        return path;
    },
    createFile: function (name, handlers, content) {
        return extend({
            name:     name,
            content: content,
        }, std.file, handlers);
    },
    createDirectory: function (name, handlers, children) {
        return extend({
            name:     name,
            children: children || {},
        }, std.dir, handlers);
    },
};

var root = std.createDirectory("", {
    mkdir: function (name, mode, callback) {
        var jid = new xmpp.JID(name);
        console.log("create new jid " + jid);
        var node = std.createDirectory(name, undefined, {
            password: std.createFile("password"),
            resource: std.createFile("resource"),
        });
        node.jid = jid;
        this.children[name] = node;
        callback(0);
    },
});

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
//     console.log("NODE", event, node)
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
        var err = 0; // assume success
        callback(err);
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

    rmdir: function (callback) {
        delegate("rmdir", path, [callback]);
    },

    release: function (path, fd, callback) {
        callback(0);
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