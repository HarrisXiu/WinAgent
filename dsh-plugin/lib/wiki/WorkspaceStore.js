"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceStore = exports.digest = void 0;
exports.splitSource = splitSource;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const digest = (text) => (0, crypto_1.createHash)('sha256').update(text).digest('hex');
exports.digest = digest;
/** Lossless splitting: every character belongs to a chunk; anchors refer to extracted text lines. */
function splitSource(text, budget = 5500) {
    if (budget < 100)
        throw new Error('分块预算过小');
    const chunks = [];
    let offset = 0, line = 1;
    while (offset < text.length) {
        let end = Math.min(offset + budget, text.length);
        if (end < text.length) {
            const newline = text.lastIndexOf('\n', end - 1);
            if (newline > offset + budget / 2)
                end = newline + 1;
            if (/[\uD800-\uDBFF]/.test(text[end - 1]))
                end--;
        }
        const body = text.slice(offset, end);
        const lineEnd = line + (body.match(/\n/g) || []).length;
        chunks.push({ id: `part-${chunks.length + 1}`, text: body, lineStart: line, lineEnd });
        offset = end;
        line = lineEnd;
    }
    return chunks;
}
/** One atomic file per record, in the vault so backups and vault switching include state. */
class WorkspaceStore {
    root;
    constructor(root) {
        this.root = root;
    }
    file(kind, id) {
        if (!/^[a-zA-Z0-9_-]+$/.test(id))
            throw new Error('无效记录标识');
        return path_1.default.join(this.root(), '.winagent', kind, `${id}.json`);
    }
    async read(kind, id) {
        try {
            return JSON.parse(await fs_1.promises.readFile(this.file(kind, id), 'utf8'));
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return null;
            throw e;
        }
    }
    async write(kind, id, value) {
        const file = this.file(kind, id);
        await fs_1.promises.mkdir(path_1.default.dirname(file), { recursive: true });
        const tmp = `${file}.${(0, crypto_1.randomUUID)()}.tmp`;
        await fs_1.promises.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
        await fs_1.promises.rename(tmp, file);
    }
    async remove(kind, id) {
        await fs_1.promises.rm(this.file(kind, id), { force: true });
    }
    async list(kind) {
        const dir = path_1.default.dirname(this.file(kind, 'record'));
        let names;
        try {
            names = await fs_1.promises.readdir(dir);
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return [];
            throw e;
        }
        const records = [];
        for (const name of names.filter(n => n.endsWith('.json'))) {
            const value = await this.read(kind, name.slice(0, -5));
            if (value)
                records.push(value);
        }
        return records;
    }
    sources() { return this.list('sources'); }
    rules() { return this.list('rules'); }
    jobs() { return this.list('jobs'); }
    async recover() {
        for (const job of await this.jobs())
            if (job.status === 'running') {
                await this.write('jobs', job.id, { ...job, status: 'interrupted', error: '上次处理已中断，重试将复用已完成的分析。', updated: new Date().toISOString() });
            }
    }
    saveReport(report) { return this.write('tasks', report.id, report); }
}
exports.WorkspaceStore = WorkspaceStore;
