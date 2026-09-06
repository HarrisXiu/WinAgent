"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.path = exports.fs = exports.ToolRegistry = void 0;
exports.str = str;
exports.num = num;
exports.bool = bool;
const fs_1 = require("fs");
Object.defineProperty(exports, "fs", { enumerable: true, get: function () { return fs_1.promises; } });
const path_1 = __importDefault(require("path"));
exports.path = path_1.default;
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
/** 简易工具注册表 */
class ToolRegistry {
    tools = new Map();
    register(tools) {
        for (const t of tools)
            this.tools.set(t.schema.name, t);
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return [...this.tools.values()];
    }
    getInfos() {
        return this.list().map((t) => ({
            name: t.schema.name,
            description: t.schema.description,
            dangerous: !!t.dangerous,
            module: t.module || 'unknown',
        }));
    }
    getSchemas() {
        return this.list().map((t) => t.schema);
    }
    async execute(name, args) {
        const t = this.tools.get(name);
        if (!t)
            throw new Error(`未知工具: ${name}`);
        return t.run(args ?? {});
    }
}
exports.ToolRegistry = ToolRegistry;
