var mask = {
  d:0040000, // Directory
  c:0020000, // Character device
  b:0060000, // Block device
'-':0100000, // Regular file
  p:0010000, // FIFO
  l:0120000, // Symbolic link.
  s:0140000, // Socket
};
module.exports = function mode(o) {
    if (typeof(o) == 'string')
        return mask[(o = String(o).toLowerCase().split("").reverse()).pop()] +
        "ugo".split("").reduce(function (p,v,s) {
            s = (2 - s) * 3;
            return p + "xwr".split("").reduce(function (x,m,i) {
                return x + ( m === o[s+i] ? (Math.pow(2, i) << s) : 0);
            }, 0);
        }, 0);
    return Object.keys(mask).map(function (t) {
        return mask[t]==(o&0170000)&&t||""}).join("") +
        "ogu".split("").map(function (v,s) {
            s *= 3; var shift = 07 << s;
            return "xwr".split("").map(function (m,i) {
                return (((o & shift) >> s) & Math.pow(2, i)) ? m : "-";
            }).reverse().join("");
        }).reverse().join("");
}
