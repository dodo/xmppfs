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
