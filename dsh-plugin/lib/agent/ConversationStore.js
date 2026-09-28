"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationStore = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
class ConversationStore {
    root;
    constructor(root) {
        this.root = root;
    }
    file(id) {
        if (!/^[a-zA-Z0-9_-]+$/.test(id))
            throw new Error('无效任务 ID');
        return path_1.default.join(this.root, `${id}.json`);
    }
    async list() {
        await fs_1.promises.mkdir(this.root, { recursive: true });
        const files = (await fs_1.promises.readdir(this.root)).filter(f => f.endsWith('.json'));
        const records = await Promise.all(files.map(f => this.read(f.slice(0, -5))));
        return records.map(({ id, title, updated, kind, topicTag }) => ({ id, title, updated, kind, topicTag })).sort((a, b) => b.updated.localeCompare(a.updated));
    }
    async read(id) { return JSON.parse(await fs_1.promises.readFile(this.file(id), 'utf8')); }
    async write(record) {
        const file = this.file(record.id);
        await fs_1.promises.mkdir(this.root, { recursive: true });
        const temporary = `${file}.${(0, crypto_1.randomUUID)()}.tmp`;
        await fs_1.promises.writeFile(temporary, JSON.stringify(record), 'utf8');
        await fs_1.promises.rename(temporary, file);
    }
}
exports.ConversationStore = ConversationStore;
