var fs = require('fs');
var Path = require('path');

var extend = require('extend');
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



var std = {
    dir: {
        open: function (flags, callback) {
            callback(0);
        },

        getattr: function (callback) {
            callback(0, {
                uid:process.getuid(),
                gid:process.getgid(),
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
            console.log(this.name, convertOpenFlags(flags))
            callback(0);
        },

        read: function (offset, len, buf, fd, callback) {
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
        },

        write: function (offset, len, buf, fd, callback) {
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
        },

        truncate: function (offset, callback) {
            this.content = this.content || "";
            if (offset < this.content.length) {
                this.content = this.content.substring(0, offset);
            } else {
                var numBlankChars = offset - this.content.length;
                while (numBlankChars--) this.content += " ";
            }
            callback(0);
        },

        getattr: function (callback) {
            var len = this.content && this.content.length;
            callback(0, {
                uid:process.getuid(),
                gid:process.getgid(),
                size: len || 0,
                mode: 0100666,
                mtime: this.time.modify,
                ctime: this.time.change,
                atime: this.time.access,
            });
        },

        readdir: function (callback) {
            callback(-22); // EINVAL
        },

    },

    // helper

    path: function (node) {
        var path = node.name;
        while ((node = node.parent)) path = Path.join(node.name, path);
        return path;
    },

    createFile: function (name, handlers, content) {
        var now = new Date();
        return extend({
            name:     name,
            content: content,
            time: {access:now, modify:now, change:now},
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
            password: std.createFile("password", null, "secret"),
            resource: std.createFile("resource"),
            messages: std.createFile("messages"),
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
//     console.log("NODE", event, path, node && node.name)
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