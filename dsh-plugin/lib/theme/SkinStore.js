"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkinStore = exports.SKIN_SLOTS = void 0;
/**
 * 主题包（外观皮肤）库：用户上传的 gif/png/jpg/webp 素材存储与元数据管理。
 * 素材复制到 {dataDir}/skins/<id>/<slot>.<ext>，元数据存 skins/skins.json。
 *
 * 槽位可缺省：只传 idle 也能用，渲染层其余状态回退到 idle（降低制作门槛）。
 * 主进程经 winagent-skin://<skinId>/<slot> 自定义协议把素材送达渲染层（带 ?v=mtime 缓存失效）。
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
/** 单个素材文件大小上限 */
const MAX_SKIN_FILE = 5 * 1024 * 1024;
const MIME_BY_EXT = {
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
};
exports.SKIN_SLOTS = ['idle', 'think', 'tool', 'vision', 'talk', 'avatar'];
class SkinStore {
    dir;
    metaPath;
    constructor(dataDir) {
        this.dir = path_1.default.join(dataDir, 'skins');
        this.metaPath = path_1.default.join(this.dir, 'skins.json');
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
    /** 新建空主题包（素材随后逐槽位上传） */
    async create(name) {
        const meta = {
            id: `sk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            name: (name || '').trim().slice(0, 30) || '未命名主题包',
            slots: {},
            createdAt: new Date().toISOString()
        };
        const list = await this.loadMeta();
        list.unshift(meta);
        await this.saveMeta(list);
        return meta;
    }
    async requireMeta(id) {
        const meta = (await this.loadMeta()).find((m) => m.id === id);
        if (!meta)
            throw new Error(`主题包不存在: ${id}`);
        return meta;
    }
    /** 写回单个主题包的元数据 */
    async patchMeta(meta) {
        const list = await this.loadMeta();
        const idx = list.findIndex((m) => m.id === meta.id);
        if (idx >= 0)
            list[idx] = meta;
        await this.saveMeta(list);
    }
    /** 上传槽位素材：校验格式与大小后复制进 <id>/<slot>.<ext>（替换旧扩展名文件） */
    async setSlot(id, slot, srcPath) {
        if (!exports.SKIN_SLOTS.includes(slot))
            throw new Error(`未知的槽位: ${slot}`);
        const meta = await this.requireMeta(id);
        const ext = path_1.default.extname(srcPath).toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime)
            throw new Error('仅支持 png / gif / jpg / webp 格式的图片');
        const buf = await fs_1.promises.readFile(srcPath);
        if (buf.length > MAX_SKIN_FILE) {
            throw new Error(`图片过大（约 ${(buf.length / 1024 / 1024).toFixed(1)}MB），请控制在 5MB 以内`);
        }
        const skinDir = path_1.default.join(this.dir, id);
        await fs_1.promises.mkdir(skinDir, { recursive: true });
        // 旧文件扩展名可能不同，先清掉同槽位旧文件
        const entries = await fs_1.promises.readdir(skinDir).catch(() => []);
        for (const f of entries) {
            if (f.startsWith(`${slot}.`))
                await fs_1.promises.rm(path_1.default.join(skinDir, f), { force: true }).catch(() => { });
        }
        const file = `${slot}${ext}`;
        await fs_1.promises.writeFile(path_1.default.join(skinDir, file), buf);
        const st = await fs_1.promises.stat(path_1.default.join(skinDir, file));
        meta.slots[slot] = { file, mtime: Math.round(st.mtimeMs) };
        await this.patchMeta(meta);
        return meta;
    }
    /** 清空槽位（素材缺失不报错） */
    async clearSlot(id, slot) {
        const meta = await this.requireMeta(id);
        const file = meta.slots[slot]?.file;
        if (file)
            await fs_1.promises.rm(path_1.default.join(this.dir, id, file), { force: true }).catch(() => { });
        delete meta.slots[slot];
        await this.patchMeta(meta);
        return meta;
    }
    /** 删除主题包（整个目录 + 元数据） */
    async remove(id) {
        const list = await this.loadMeta();
        if (!list.some((m) => m.id === id))
            return;
        await fs_1.promises.rm(path_1.default.join(this.dir, id), { recursive: true, force: true }).catch(() => { });
        await this.saveMeta(list.filter((m) => m.id !== id));
    }
    /** 重命名主题包 */
    async rename(id, name) {
        const meta = await this.requireMeta(id);
        const next = (name || '').trim().slice(0, 30);
        if (next)
            meta.name = next;
        await this.patchMeta(meta);
        return this.loadMeta();
    }
    /** 解析槽位文件的绝对路径（协议处理器用；不存在返回 null） */
    resolveSlotFile(id, slot, file) {
        if (!exports.SKIN_SLOTS.includes(slot))
            return null;
        const safe = path_1.default.basename(file);
        return path_1.default.join(this.dir, path_1.default.basename(id), safe);
    }
}
exports.SkinStore = SkinStore;
