"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const ConfigStore_1 = require("../config/ConfigStore");
class LoggerImpl {
    stream = null;
    dir;
    day = '';
    constructor() {
        this.dir = path_1.default.join((0, ConfigStore_1.getDataDir)(), 'Logs');
    }
    async ensure() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.stream && this.day === today)
            return;
        await fs_1.promises.mkdir(this.dir, { recursive: true });
        this.stream?.end();
        this.day = today;
        this.stream = (0, fs_1.createWriteStream)(path_1.default.join(this.dir, `agent_${today}.log`), { flags: 'a' });
    }
    ts() {
        return new Date().toISOString().replace('T', ' ').slice(0, 23);
    }
    async write(level, msg) {
        try {
            await this.ensure();
            this.stream?.write(`[${this.ts()}] [${level}] ${msg}\n`);
        }
        catch {
            /* ignore logging failures */
        }
    }
    info(msg) {
        void this.write('INFO', msg);
    }
    error(msg) {
        void this.write('ERROR', msg);
    }
    // 脱敏后记录请求/响应
    section(title, body) {
        void this.write(title, '\n' + body + '\n' + '─'.repeat(80));
    }
}
exports.Logger = new LoggerImpl();
