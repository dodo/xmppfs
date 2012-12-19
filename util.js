var crypto = require('crypto');

var moment = require('moment');
moment.lang('en');
moment.calendar = {
    sameDay:  " ",
    lastDay:  " [Yesterday at] ",
    nextDay:  " [Tomorrow at] ",
    lastWeek: " [last] dddd [at] ",
    nextWeek: " dddd [at] ",
    sameElse: " DD.MM.YYYY ",
};

exports.formatDate = function (date) {
    date = moment(date);
    return "[" + date.calendar().substr(1) + date.format("HH:mm:ss") + "]";
};

exports.escapeResource = function (resource) {
    return ("" + resource).replace("/", "_");
};

exports.sha1 = function (data) {
    var hash = crypto.createHash('sha1');
    hash.update(data);
    return hash.digest('hex');
}

exports.foldl = function (arr, fn) {
    return arr.reduce(function (a,e) {return a.concat(fn(e))}, []);
};

exports.mapObject = function (object, fn) {
    var res = {};
    Object.keys(object||{}).forEach(function (key) {
        var x = fn(key, object[key], object);
        if (x) res[x[0]] = x[1];
    });
    return res;
};

exports.filterObject = function (object, fn) {
    var res = {};
    Object.keys(object||{}).forEach(function (key) {
        var value = object[key]
        if (fn(key, value, object) === true) res[key] = value;
    });
    return res;
};

var optionalParam = /\((.*?)\)/g;
var namedParam    = /:\w+/g;
var matchParam    = /:(\w+)/g;
var splatParam    = /\*\w+/g;
var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;
exports.routeToRegExp = routeToRegExp;
function routeToRegExp(route) {
    var keys = (route.match(matchParam)||[]).map(function(k){return k.substr(1)});
    route = route.replace(escapeRegExp, '\\$&')
                 .replace(optionalParam, '(?:$1)?')
                 .replace(namedParam, '([^\/]+)')
                 .replace(splatParam, '(.*?)');
    return {keys:keys, re:new RegExp('^' + route + '$')};
};

var cache = {};
exports.matchUrl = function (routes, url) {
    var res = {params:{}, path:url};
    var match, route, keys = Object.keys(routes);
    for (var path, i = 0 ; path = keys[i] ; i++) {
        if (!(route = cache[path])) route = cache[path] = routeToRegExp(path);
        if ((match = route.re.exec(url))) {
            res.path = path;
            match = match.slice(1);
            route.keys.forEach(function (k) {res.params[k] = match.pop()});
            break;
        }
    }
    return res;
};
