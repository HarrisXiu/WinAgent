"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.str = str;
exports.num = num;
exports.bool = bool;
function str(v, def = '') {
    return v === undefined || v === null ? def : String(v);
}
function num(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
function bool(v, def = false) {
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'string')
        return v.toLowerCase() === 'true';
    return def;
}
