"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionService = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const WorkspaceStore_1 = require("./WorkspaceStore");
const DetailedAnalysis_1 = require("./DetailedAnalysis");
class IngestionService {
    workspace;
    vault;
    search;
    store;
    extract;
    progress;
    changed;
    running = new Map();
    constructor(workspace, vault, search, store, extract, progress, changed) {
        this.workspace = workspace;
        this.vault = vault;
        this.search = search;
        this.store = store;
        this.extract = extract;
        this.progress = progress;
        this.changed = changed;
    }
    cancel(id) {
        for (const [key, task] of this.running)
            if (!id || key === id)
                task.controller.abort();
    }
    get active() { return this.running.size > 0; }
    index(source) {
        this.search.indexNote({ path: source.sourcePath, title: source.title, tags: [], kind: 'file', created: source.created, updated: source.created }, source.chunks.map(c => c.text).join('') + '\n' + source.sections.map(s => s.markdown).join('\n'));
    }
    run(rawPath, force = false) {
        rawPath = rawPath.replace(/\\/g, '/');
        if (!rawPath.startsWith('raw/') || rawPath.split('/').some(s => s === '..'))
            return Promise.reject(new Error('只能分析知识库 raw 目录中的原始文件'));
        const id = (0, WorkspaceStore_1.digest)(rawPath).slice(0, 24);
        const existing = this.running.get(id);
        if (existing)
            return existing.promise;
        const controller = new AbortController();
        const promise = this.process(id, rawPath, controller.signal, force).finally(() => this.running.delete(id));
        this.running.set(id, { promise, controller });
        return promise;
    }
    async process(id, rawPath, signal, force) {
        const title = path_1.default.basename(rawPath), root = this.vault.getVaultPath();
        const job = { id, rawPath, title, status: 'running', stage: '读取资料', completed: 0, total: 0, updated: new Date().toISOString() };
        let source = null;
        const saveJob = async () => { job.updated = new Date().toISOString(); await this.workspace.write('jobs', id, job); this.changed(rawPath); };
        const result = (sourcePath) => ({ sourcePath, conceptPaths: [], entityPaths: [], created: [sourcePath], updated: [], logEntry: `全文整理 ${title}` });
        await saveJob();
        try {
            const absolute = path_1.default.resolve(root, rawPath);
            const realRoot = await fs_1.promises.realpath(root), realFile = await fs_1.promises.realpath(absolute);
            const relative = path_1.default.relative(realRoot, realFile);
            if (relative.startsWith('..') || path_1.default.isAbsolute(relative))
                throw new Error('原始文件必须位于当前知识库内');
            const buf = await fs_1.promises.readFile(absolute), hash = (0, WorkspaceStore_1.digest)(buf);
            const prior = await this.workspace.read('sources', id);
            const provider = this.store.activeProvider();
            const recipe = (0, WorkspaceStore_1.digest)(JSON.stringify([4, hash, provider?.baseUrl, provider?.model]));
            const completed = await this.workspace.read('completed', id);
            if (!force && prior?.status === 'ready' && prior.hash === hash && completed?.recipe === recipe && await fs_1.promises.stat(path_1.default.join(root, prior.sourcePath)).catch(() => null)) {
                this.index(prior);
                job.status = 'done';
                job.stage = '复用已完成结果';
                job.sourcePath = prior.sourcePath;
                job.completed = job.total = prior.chunks.length;
                await saveJob();
                this.progress({ file: title, stage: job.stage, percent: 100, done: true });
                return result(prior.sourcePath);
            }
            job.stage = '解析全文';
            await saveJob();
            const ext = path_1.default.extname(rawPath).slice(1).toLowerCase();
            let text = '';
            if (['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'xlsm'].includes(ext))
                text = await this.extract(absolute, ext);
            else if (!buf.includes(0) && !['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext))
                text = buf.toString('utf8');
            const hasReadableText = text.replace(/【PDF 第 \d+ 页】|【本页未提取到文字，需要 OCR 或核对原页】/g, '').trim();
            if (!hasReadableText)
                text = '';
            signal.throwIfAborted();
            source = { id, title, rawPath, hash, sourcePath: `wiki/sources/source-${id}.md`, created: new Date().toISOString(),
                status: text.trim() ? 'indexed' : 'limited', chunks: (0, WorkspaceStore_1.splitSource)(text, 2400), sections: [],
                error: text.trim() ? undefined : '未提取到可分析文字。扫描页、图片需要先完成 OCR；原始文件已保留。' };
            await this.workspace.write('sources', id, source);
            if (!source.chunks.length)
                throw new Error(source.error);
            this.index(source);
            this.changed(source.sourcePath);
            job.total = source.chunks.length;
            job.stage = '已可检索，逐段整理知识';
            await saveJob();
            if (!provider)
                throw new Error('资料已解析并可检索，请配置分析模型后重试知识整理');
            source.status = 'analyzing';
            await this.workspace.write('sources', id, source);
            const analysis = await (0, DetailedAnalysis_1.analyzeDetailed)(provider, title, text, { workspace: this.workspace, signal, force,
                onProgress: async (done, total) => {
                    job.completed = done;
                    job.total = total;
                    job.stage = `详细知识 ${done}/${total}`;
                    await saveJob();
                    this.progress({ file: title, stage: job.stage, percent: Math.round(20 + 65 * done / total) });
                }
            });
            signal.throwIfAborted();
            source.sections = analysis.sections || [];
            const body = `# ${title}\n\n> AI 知识草稿 · 已覆盖 ${analysis.coverage?.completed}/${analysis.coverage?.total} 个原文片段 · 原文版本 ${hash.slice(0, 12)}\n\n## 阅读导航\n\n${source.sections.map(s => `- ${s.title}：${s.overview}`).join('\n')}\n\n${(0, DetailedAnalysis_1.sectionsMarkdown)(source.sections, source.chunks)}\n`;
            const previousNote = await this.vault.readNote(source.sourcePath).catch(() => null);
            await this.vault.writeNote(source.sourcePath, { title, body, tags: [...new Set(['详细知识', 'AI草稿', ...(previousNote?.tags.filter(t => t.startsWith('专题:')) || [])])] });
            source.status = 'ready';
            source.error = undefined;
            await this.workspace.write('sources', id, source);
            await this.workspace.write('completed', id, { recipe });
            this.index(source);
            job.status = 'done';
            job.sourcePath = source.sourcePath;
            job.stage = '全文整理完成';
            await saveJob();
            this.changed(source.sourcePath);
            this.progress({ file: title, stage: '全文整理完成', percent: 100, done: true });
            return result(source.sourcePath);
        }
        catch (e) {
            const message = signal.aborted ? '已取消，可重试并复用已完成片段' : e instanceof Error ? e.message : String(e);
            job.status = signal.aborted ? 'cancelled' : 'error';
            job.error = message;
            await saveJob();
            if (source) {
                source.status = source.status === 'limited' ? 'limited' : 'error';
                source.error = message;
                await this.workspace.write('sources', id, source);
            }
            this.progress({ file: title, stage: message, percent: 0, error: message });
            throw new Error(message);
        }
    }
}
exports.IngestionService = IngestionService;
