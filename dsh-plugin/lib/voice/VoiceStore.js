"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceStore = void 0;
/**
 * 克隆音色库：参考音频样本（wav/mp3）的本地存储与元数据管理。
 * 样本复制到 {dataDir}/voices/<id>.<ext>，元数据存 {dataDir}/voices/voices.json。
 * MiMo 克隆接口无服务端音色注册，每次合成请求都携带样本 base64。
 *
 * 分段合成下每段请求都会带样本，这里按 id + 文件 mtime 缓存 base64，
 * 避免同一段会话里 N 段就重读 N 次最大 7.5MB 的文件并重复 base64 编码。
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
/** 克隆样本原始字节上限（API 硬限制 10MB base64，等效原始文件约 7.5MB） */
const MAX_SAMPLE_BYTES = Math.floor(10 * 1024 * 1024 * 0.75);
const MIME_BY_EXT = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg'
};
class VoiceStore {
    dir;
    metaPath;
    /** 样本 base64 缓存：key = 音色 id，mtime 变化即失效 */
    cache = new Map();
    constructor(dataDir) {
        this.dir = path_1.default.join(dataDir, 'voices');
        this.metaPath = path_1.default.join(this.dir, 'voices.json');
    }
    async loadMeta() {
        try {
            const raw = await fs_1.promises.readFile(this.metaPath, 'utf-8');
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        }
        catch {
            return [];
        }
    }
    async saveMeta(list) {
        await fs_1.promises.mkdir(this.dir, { recursive: true });
        await fs_1.promises.writeFile(this.metaPath, JSON.stringify(list, null, 2), 'utf-8');
    }
    async list() {
        return this.loadMeta();
    }
    /** 上传/导入参考音频：校验格式与大小后复制进音色库 */
    async add(name, srcPath) {
        const ext = path_1.default.extname(srcPath).toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime)
            throw new Error('仅支持 wav / mp3 格式的参考音频');
        const buf = await fs_1.promises.readFile(srcPath);
        if (buf.length > MAX_SAMPLE_BYTES) {
            throw new Error(`参考音频过大（约 ${(buf.length / 1024 / 1024).toFixed(1)}MB），请控制在 7.5MB 以内`);
        }
        const id = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const file = `${id}${ext}`;
        await fs_1.promises.mkdir(this.dir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(this.dir, file), buf);
        const meta = {
            id,
            name: (name || path_1.default.basename(srcPath, ext)).trim().slice(0, 30) || '未命名音色',
            file,
            mime,
            createdAt: new Date().toISOString()
        };
        const list = await this.loadMeta();
        list.unshift(meta);
        await this.saveMeta(list);
        return meta;
    }
    /** 删除克隆音色（文件 + 元数据 + 缓存；样本缺失不报错） */
    async remove(id) {
        const list = await this.loadMeta();
        const target = list.find((v) => v.id === id);
        if (!target)
            return;
        await fs_1.promises.rm(path_1.default.join(this.dir, target.file), { force: true }).catch(() => { });
        this.cache.delete(id);
        await this.saveMeta(list.filter((v) => v.id !== id));
    }
    /** 重命名克隆音色 */
    async rename(id, name) {
        const list = await this.loadMeta();
        const target = list.find((v) => v.id === id);
        if (!target)
            throw new Error(`克隆音色不存在: ${id}`);
        const next = (name || '').trim().slice(0, 30);
        if (next)
            target.name = next;
        await this.saveMeta(list);
        return list;
    }
    async requireMeta(id) {
        const meta = (await this.loadMeta()).find((v) => v.id === id);
        if (!meta)
            throw new Error(`克隆音色不存在: ${id}`);
        return meta;
    }
    /** 读取样本 base64（带 mtime 缓存，供克隆请求与试听） */
    async getSampleBase64(id) {
        const meta = await this.requireMeta(id);
        const file = path_1.default.join(this.dir, meta.file);
        const hit = this.cache.get(id);
        if (hit) {
            const st = await fs_1.promises.stat(file).catch(() => null);
            if (st && st.mtimeMs === hit.mtimeMs)
                return { base64: hit.base64, mime: hit.mime };
            this.cache.delete(id);
        }
        let buf;
        try {
            buf = await fs_1.promises.readFile(file);
        }
        catch {
            throw new Error(`克隆音色样本文件缺失: ${meta.name}`);
        }
        const st = await fs_1.promises.stat(file).catch(() => null);
        const entry = { mtimeMs: st?.mtimeMs ?? 0, base64: buf.toString('base64'), mime: meta.mime };
        this.cache.set(id, entry);
        return { base64: entry.base64, mime: entry.mime };
    }
    /** 样本 dataURL（audio.voice 克隆参数直接可用） */
    async getSampleDataUrl(id) {
        const { base64, mime } = await this.getSampleBase64(id);
        return `data:${mime};base64,${base64}`;
    }
}
exports.VoiceStore = VoiceStore;
