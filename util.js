var moment = require('moment');

exports.formatDate = function (date) {
    return "[" + moment(date).format("hh:mm:ss") + "]";
}

exports.escapeResource = function (resource) {
    return ("" + resource).replace("/", "_");
}