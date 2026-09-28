"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikiHost = void 0;
exports.flattenWikiNotes = flattenWikiNotes;
/**
 * Wiki 宿主：LLM Wiki 知识库管线（INGEST / 导入 / 工作流）从 Electron 主进程
 * 移植到 DSH 插件。事件广播由 IPC 改为 EventBus。
 * @module dsh-winagent/wiki-host
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const gray_matter_1 = __importDefault(require("gray-matter"));
const Logger_1 = require("../util/Logger");
const platform_1 = require("../platform");
const VaultManager_1 = require("./VaultManager");
const SearchIndex_1 = require("./SearchIndex");
const GraphEngine_1 = require("./GraphEngine");
const AiPipeline_1 = require("./AiPipeline");
const WorkspaceStore_1 = require("./WorkspaceStore");
const RuleService_1 = require("./RuleService");
const IngestionService_1 = require("./IngestionService");
const contract_1 = require("./contract");
const WorkflowService_1 = require("./WorkflowService");
const slug_1 = require("./slug");
/** 扁平化笔记树 */
function flattenWikiNotes(notes) {
    const result = [];
    for (const n of notes) {
        result.push(n);
        if (n.children)
            result.push(...flattenWikiNotes(n.children));
    }
    return result;
}
/** 中文名 → 英文小写连字符 slug（统一走 slugifyKebab，契约 §0） */
function slugify(name) {
    return (0, slug_1.slugifyKebab)(name, 'concept');
}
async function fileExists(p) {
    try {
        await fs_1.promises.access(p);
        return true;
    }
    catch {
        return false;
    }
}
function isOlderThan(dateStr, days) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime()))
        return false;
    return Date.now() - d.getTime() > days * 24 * 60 * 60 * 1000;
}
/**
 * 子进程调用文档提取脚本（pdf/pptx/docx/xlsx/xlsm/doc/xls/ppt）。
 * 与 skill 同一代码路径；NODE_PATH 让脚本能 require 插件依赖。
 */
function extractDocumentText(absPath, format) {
    return new Promise((resolve, reject) => {
        const scriptPath = path_1.default.join(platform_1.PACKAGE_ROOT, 'assets', 'skills', 'pdf', 'read_doc.js');
        const proc = (0, child_process_1.spawn)(process.execPath, [scriptPath], { env: (0, platform_1.skillEnv)(), windowsHide: true });
        let out = '';
        let err = '';
        proc.stdout.on('data', (d) => (out += d.toString()));
        proc.stderr.on('data', (d) => (err += d.toString()));
        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(out.trim());
                    if (parsed.truncated)
                        throw new Error('提取文本不完整，无法进行全文分析');
                    resolve(String(parsed.text || ''));
                }
                catch {
                    reject(new Error('提取脚本输出解析失败'));
                }
            }
            else {
                reject(new Error(err.trim() || `提取脚本退出码 ${code}`));
            }
        });
        proc.on('error', (e) => reject(e));
        proc.stdin.write(JSON.stringify({ path: absPath, format, max_chars: Number.MAX_SAFE_INTEGER }));
        proc.stdin.end();
    });
}
class WikiHost {
    store;
    bus;
    vault;
    search;
    graph;
    pipeline;
    workspace;
    rules;
    ingestion;
    batchSession = null;
    autoIngestQueue = new Map();
    recentIngests = new Map();
    /** 进行中的 REFLECT/QUERY 工作流取消器（workflowCancel 用） */
    workflowAbort = null;
    constructor(store, bus) {
        this.store = store;
        this.bus = bus;
        this.vault = new VaultManager_1.VaultManager(store.resolveVaultPath());
        this.search = new SearchIndex_1.SearchIndex();
        this.graph = new GraphEngine_1.GraphEngine();
        this.pipeline = new AiPipeline_1.AiPipeline();
        this.workspace = new WorkspaceStore_1.WorkspaceStore(() => this.vault.getVaultPath());
        this.rules = new RuleService_1.RuleService(this.workspace, this.vault);
        this.ingestion = new IngestionService_1.IngestionService(this.workspace, this.vault, this.search, this.store, extractDocumentText, p => this.emitIngestProgress(p), p => this.bus.push('vaultChanged', { type: 'modified', path: p }));
    }
    async init() {
        await this.vault.initialize();
        await this.workspace.recover();
        this.vault.onChange((event) => {
            this.bus.push('vaultChanged', event);
            if (event.type === 'created' && event.path.startsWith('raw/') && event.path !== 'raw/') {
                this.scheduleAutoIngest(event.path);
            }
        });
        await this.indexWikiVault();
        for (const source of await this.workspace.sources())
            this.ingestion.index(source);
        await this.rebuildGraph();
    }
    dispose() {
        this.ingestion.cancel();
        this.vault.dispose();
        for (const timer of this.autoIngestQueue.values())
            clearTimeout(timer);
        this.autoIngestQueue.clear();
    }
    /** 后台索引 wiki 层笔记（raw 层不索引） */
    async indexWikiVault() {
        const allNotes = await this.vault.listNotes();
        const flatNotes = flattenWikiNotes(allNotes);
        const filesOnly = flatNotes.filter((n) => n.kind === 'file' && n.path.startsWith('wiki/'));
        const indexData = [];
        for (const n of filesOnly) {
            try {
                const note = await this.vault.readNote(n.path);
                indexData.push({ meta: n, note });
            }
            catch { /* skip */ }
        }
        for (const d of indexData) {
            this.indexFromContent(d.meta, d.note);
        }
        Logger_1.Logger.info(`[Wiki] 已索引 ${indexData.length} 篇 wiki 笔记`);
    }
    /** 从 VaultManager 收集笔记并重建图谱（只含 wiki/ 层，排除 graph-excluded） */
    async rebuildGraph() {
        const notes = await this.vault.listNotes();
        const flatNotes = flattenWikiNotes(notes).filter((n) => n.kind === 'file' && n.path.startsWith('wiki/'));
        const inputs = [];
        for (const n of flatNotes) {
            try {
                const content = await this.vault.readNote(n.path);
                if (content.graphExcluded)
                    continue;
                // aiRelations（AI 分析发现的关系）入图，让 AI 关系与手工 wikilink 同屏可见
                inputs.push({
                    path: n.path, title: n.title, tags: n.tags, links: content.links,
                    aiRelations: (content.aiRelations || []).map((r) => r.target).filter(Boolean)
                });
            }
            catch { /* skip */ }
        }
        this.graph.rebuild(inputs);
    }
    async indexOne(relPath) {
        try {
            const note = await this.vault.readNote(relPath);
            this.indexFromContent({
                path: note.path, title: note.title, tags: note.tags,
                created: note.created, updated: note.updated, kind: 'file'
            }, note);
        }
        catch { /* skip */ }
    }
    /** 按读取结果建索引：附带 frontmatter 的 aliases/confidence/source_count（检索分层与 RAG 用） */
    indexFromContent(meta, note) {
        this.search.indexNote(meta, note.rawBody, note.aiSummary, {
            aliases: note.aliases,
            confidence: note.confidence,
            sourceCount: note.sourceCount
        });
    }
    // ──────────────────────── 基础笔记操作 ────────────────────────
    async listNotes() {
        return this.vault.listNotes();
    }
    async readNote(relPath) {
        return this.vault.readNote(relPath);
    }
    async writeNote(relPath, data) {
        await this.vault.writeNote(relPath, data);
        await this.indexOne(relPath);
        this.rebuildGraph().catch(() => { });
    }
    async deleteNote(relPath) {
        if (!relPath.startsWith('wiki/') || relPath.split(/[\\/]/).includes('..'))
            throw new Error('只能删除 Wiki 资料文件');
        if (this.vault.isSystemFile(relPath))
            throw new Error('系统文件受保护，不能删除');
        if (this.ingestion.active)
            throw new Error('资料正在解析，请等待解析完成后删除');
        const source = (await this.workspace.sources()).find(s => s.sourcePath === relPath);
        if (source && (!source.rawPath.startsWith('raw/') || source.rawPath.split(/[\\/]/).includes('..')))
            throw new Error('原始文件路径异常，未删除任何资料');
        try {
            await this.vault.deleteNote(relPath);
        }
        catch (e) {
            if (!source || e.code !== 'ENOENT')
                throw e;
        }
        this.search.removeNote(relPath);
        if (source) {
            await fs_1.promises.rm(path_1.default.join(this.vault.getVaultPath(), source.rawPath), { force: true });
            for (const kind of ['sources', 'completed', 'jobs'])
                await this.workspace.remove(kind, source.id);
        }
        for (const rule of await this.workspace.rules())
            if (rule.sourcePath === relPath)
                await this.workspace.remove('rules', rule.id);
        this.bus.push('vaultChanged', { type: 'deleted', path: relPath });
        this.rebuildGraph().catch(() => { });
    }
    async createNote(relPath, title) {
        await this.vault.createNote(relPath, title);
        this.rebuildGraph().catch(() => { });
    }
    getBacklinks(targetPath) {
        return this.vault.getBacklinks(targetPath);
    }
    getAllTags() {
        return this.vault.getAllTags();
    }
    getNotesByTag(tag) {
        return this.vault.getNotesByTag(tag);
    }
    searchNotes(query, limit) {
        return this.search.search(query, limit);
    }
    getGraphData() {
        return this.graph.getData();
    }
    getGraphNode(nodeId) {
        return this.graph.getNeighborhood(nodeId, 1);
    }
    // ──────────────────────── AI 分析 ────────────────────────
    async aiAnalyze(relPath) {
        try {
            const note = await this.vault.readNote(relPath);
            const allNotes = await this.vault.listNotes();
            const candidates = flattenWikiNotes(allNotes)
                .filter((n) => n.kind === 'file' && n.path.startsWith('wiki/') && n.path !== relPath)
                .map((n) => ({ path: n.path, title: n.title }));
            const noteType = relPath.startsWith('wiki/sources/') ? 'source'
                : relPath.startsWith('wiki/concepts/') ? 'concept'
                    : relPath.startsWith('wiki/entities/') ? 'entity'
                        : relPath.startsWith('raw/') ? 'raw'
                            : 'note';
            const contract = await (0, contract_1.readContractSections)(this.vault.getVaultPath(), ['总则', 'wikilink', 'confidence', '个人写作', '质量红线']);
            const openQuestions = await this.vault.getOpenQuestions();
            const cfg = this.store.get();
            const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0];
            if (!provider)
                throw new Error('没有可用的 AI 模型，请先在设置中配置');
            const result = await this.pipeline.analyze(provider, note.title, note.rawBody, candidates, {
                noteType, contract, openQuestions,
                // 附 frontmatter 关键标量：entity_type/confidence 等字段在 frontmatter 中，正文看不到
                frontmatter: {
                    ...(note.entityType ? { entity_type: note.entityType } : {}),
                    ...(note.confidence ? { confidence: note.confidence } : {}),
                    ...(note.sourceCount !== undefined ? { source_count: note.sourceCount } : {})
                }
            });
            await this.vault.updateAiResults(relPath, result.summary, result.tags, result.relations);
            await this.indexOne(relPath);
            this.rebuildGraph().catch(() => { });
            this.bus.push('vaultChanged', { type: 'modify', path: relPath });
            return result;
        }
        catch (err) {
            if (err?.name === 'AbortError')
                return {};
            throw err;
        }
    }
    aiCancel() {
        this.ingestion.cancel();
        this.pipeline.cancel();
    }
    // ──────────────────────── INGEST ────────────────────────
    emitIngestProgress(p) {
        this.bus.push('ingestProgress', p);
    }
    emitCustomProgress(p) {
        this.bus.push('customProgress', p);
    }
    scheduleAutoIngest(relPath) {
        const last = this.recentIngests.get(relPath);
        if (last && Date.now() - last < 60000)
            return;
        const existing = this.autoIngestQueue.get(relPath);
        if (existing)
            clearTimeout(existing);
        const timer = setTimeout(async () => {
            this.autoIngestQueue.delete(relPath);
            const last2 = this.recentIngests.get(relPath);
            if (last2 && Date.now() - last2 < 60000)
                return;
            this.recentIngests.set(relPath, Date.now());
            try {
                Logger_1.Logger.info(`[AutoIngest] 检测到 raw 新文件: ${relPath}`);
                await this.runIngest(relPath);
                Logger_1.Logger.info(`[AutoIngest] 完成: ${relPath}`);
            }
            catch (e) {
                Logger_1.Logger.error(`[AutoIngest] 失败: ${relPath}: ${String(e)}`);
            }
        }, 1500);
        this.autoIngestQueue.set(relPath, timer);
    }
    async listWikiPages(dir) {
        const absDir = path_1.default.join(this.vault.getVaultPath(), 'wiki', dir);
        try {
            const entries = await fs_1.promises.readdir(absDir);
            const pages = [];
            for (const f of entries) {
                if (!f.endsWith('.md'))
                    continue;
                try {
                    const raw = await fs_1.promises.readFile(path_1.default.join(absDir, f), 'utf-8');
                    const parsed = (0, gray_matter_1.default)(raw);
                    pages.push({ slug: f.replace(/\.md$/, ''), title: parsed.data.title || f.replace(/\.md$/, '') });
                }
                catch { /* skip */ }
            }
            return pages.sort((a, b) => a.slug.localeCompare(b.slug));
        }
        catch {
            return [];
        }
    }
    async listConceptSlugs() {
        const absDir = path_1.default.join(this.vault.getVaultPath(), 'wiki', 'concepts');
        try {
            const entries = await fs_1.promises.readdir(absDir);
            const result = [];
            for (const f of entries) {
                if (!f.endsWith('.md'))
                    continue;
                try {
                    const raw = await fs_1.promises.readFile(path_1.default.join(absDir, f), 'utf-8');
                    const parsed = (0, gray_matter_1.default)(raw);
                    const fm = parsed.data;
                    result.push({
                        slug: f.replace(/\.md$/, ''),
                        title: fm.title || f.replace(/\.md$/, ''),
                        aliases: Array.isArray(fm.aliases) ? fm.aliases : []
                    });
                }
                catch { /* skip */ }
            }
            return result;
        }
        catch {
            return [];
        }
    }
    /** 执行一次 INGEST（LLM Wiki 编译）：raw 文件 → sources/concepts/entities 页 */
    async runIngest(rawRelPath, force = false) {
        this.recentIngests.set(rawRelPath, Date.now());
        return this.ingestion.run(rawRelPath, force);
    }
    // ──────────────────────── 批量摄入 ────────────────────────
    async ingestBatchStart(paths) {
        if (this.batchSession)
            throw new Error('已有批量摄入在进行中，请先完成或停止');
        if (!Array.isArray(paths) || paths.length === 0)
            throw new Error('未选择文件');
        const compiledRaw = await this.listCompiledRawFiles();
        const unique = Array.from(new Set(paths.map((p) => p.replace(/\\/g, '/'))));
        const pending = unique.filter((p) => !compiledRaw.has(p));
        if (pending.length === 0) {
            throw new Error(`所选 ${unique.length} 个文件均已编译过`);
        }
        const now = Date.now();
        for (const p of pending)
            this.recentIngests.set(p, now);
        const firstPath = pending[0];
        const first = await this.runIngest(firstPath);
        this.batchSession = { pending: pending.slice(1), done: [first], errors: [], active: false };
        return { rawFile: firstPath, first, total: pending.length };
    }
    async ingestBatchContinue() {
        if (!this.batchSession)
            return { results: [], errors: [], confirmHigh: [] };
        if (this.batchSession.active)
            throw new Error('批量摄入正在执行中');
        this.batchSession.active = true;
        try {
            for (const p of this.batchSession.pending) {
                // abort 把 batchSession 置 null 后立即停止（避免 null 解引用）
                if (!this.batchSession)
                    break;
                try {
                    const r = await this.runIngest(p);
                    if (!this.batchSession)
                        break;
                    this.batchSession.done.push(r);
                }
                catch (e) {
                    if (!this.batchSession)
                        break;
                    this.batchSession.errors.push({ path: p, error: e instanceof Error ? e.message : String(e) });
                }
            }
            if (!this.batchSession)
                return { results: [], errors: [], confirmHigh: [], aborted: true };
            const confirmHighMap = new Map();
            for (const r of this.batchSession.done) {
                for (const c of r.confirmHigh ?? []) {
                    const prev = confirmHighMap.get(c.slug);
                    if (!prev || c.sourceCount > prev.sourceCount)
                        confirmHighMap.set(c.slug, c);
                }
            }
            const result = {
                results: this.batchSession.done,
                errors: this.batchSession.errors,
                confirmHigh: Array.from(confirmHighMap.values())
            };
            this.batchSession = null;
            return result;
        }
        finally {
            if (this.batchSession)
                this.batchSession.active = false;
        }
    }
    async ingestBatchAbort() {
        this.batchSession = null;
        // 取消在飞的 LLM 请求（ingest/analyze/custom 一并中止，否则 abort 后请求仍在后台消耗）
        this.pipeline.cancel();
        return { ok: true };
    }
    async listCompiledRawFiles() {
        const result = new Set();
        const sources = await this.listWikiPages('sources');
        for (const s of sources) {
            try {
                const note = await this.vault.readNote(`wiki/sources/${s.slug}.md`);
                if (note.rawFile)
                    result.add(note.rawFile);
            }
            catch { /* skip */ }
        }
        return result;
    }
    // ──────────────────────── 工作流 ────────────────────────
    async workflowLint() {
        const r = await (0, WorkflowService_1.runLint)(this.vault);
        if (r.ok)
            this.bus.push('vaultChanged', { type: 'created', path: r.reportPath });
        return r;
    }
    async workflowReflect() {
        const ac = new AbortController();
        this.workflowAbort = ac;
        try {
            const r = await (0, WorkflowService_1.runReflect)(this.vault, this.store, ac.signal);
            if (r.ok)
                this.bus.push('vaultChanged', { type: 'created', path: r.reportPath });
            return r;
        }
        finally {
            this.workflowAbort = null;
        }
    }
    /** 取消进行中的 REFLECT/QUERY 工作流（LLM 请求一并中止） */
    workflowCancel() {
        this.workflowAbort?.abort();
        this.workflowAbort = null;
    }
    async workflowMerge(keep, remove, area) {
        const r = await (0, WorkflowService_1.runMerge)(this.vault, keep, remove, area);
        if (r.ok) {
            this.bus.push('vaultChanged', { type: 'created', path: r.reportPath });
            this.bus.push('vaultChanged', { type: 'deleted', path: `wiki/${area}/${remove}.md` });
        }
        return r;
    }
    async workflowQuery(query) {
        const ac = new AbortController();
        this.workflowAbort = ac;
        try {
            const r = await (0, WorkflowService_1.runQuery)(this.vault, this.search, this.store, query, ac.signal);
            if (r.ok)
                this.bus.push('vaultChanged', { type: 'created', path: r.reportPath });
            return r;
        }
        finally {
            this.workflowAbort = null;
        }
    }
    // ──────────────────────── 导入 ────────────────────────
    async importUrl(url) {
        const target = (url || '').trim();
        if (!/^https?:\/\//i.test(target)) {
            return { ok: false, error: '请输入合法的 http/https 链接' };
        }
        let host = '';
        try {
            host = new URL(target).hostname.replace(/^www\./, '');
        }
        catch {
            return { ok: false, error: 'URL 格式不合法' };
        }
        let html = '';
        try {
            const res = await fetch(target, {
                signal: AbortSignal.timeout(20000),
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WinAgent/0.2' }
            });
            if (!res.ok)
                return { ok: false, error: `网页请求失败：HTTP ${res.status}` };
            const buf = await res.arrayBuffer();
            const contentType = res.headers.get('content-type') || '';
            if (!/text\/html|application\/xhtml/i.test(contentType)) {
                return { ok: false, error: `该 URL 返回的是 ${contentType.split(';')[0] || '未知类型'}，请下载后导入知识库` };
            }
            html = Buffer.from(buf).toString('utf-8');
        }
        catch (e) {
            return { ok: false, error: `抓取网页失败：${e instanceof Error ? e.message : String(e)}` };
        }
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || host)
            .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const cleaned = html
            .replace(/<(script|style|noscript|iframe|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .split('\n').map((l) => l.trim()).filter((l) => l.length > 0).join('\n\n')
            .slice(0, 30000);
        if (!cleaned) {
            return { ok: false, error: '网页正文为空（可能是 JS 渲染页面，请复制内容后保存为文件导入）' };
        }
        const today = new Date().toISOString().slice(0, 10);
        // slug 统一走 slugifyKebab（纯英文 kebab，契约 §0）；中文标题回退 host-时间戳
        const slug = (0, slug_1.slugifyKebab)(title, 'clipping');
        const relPath = `raw/clippings/${today}-${host}-${slug}.md`;
        const rawBody = [`# ${title}`, ``, `> 来源：${target}`, ``, cleaned, ``].join('\n');
        const rawFm = { title, date: today, source_url: target, domain: host, tags: [] };
        const absPath = path_1.default.join(this.vault.getVaultPath(), relPath);
        await fs_1.promises.mkdir(path_1.default.dirname(absPath), { recursive: true });
        await fs_1.promises.writeFile(absPath, gray_matter_1.default.stringify(rawBody, rawFm), 'utf-8');
        this.recentIngests.set(relPath, Date.now());
        const ingestResult = await this.runIngest(relPath);
        return { ok: true, relPath, sourcePath: ingestResult.sourcePath };
    }
    importFile(srcPath, targetDir) {
        return this.vault.importFile(srcPath, targetDir);
    }
    async importAnalyze(filePaths, requirement) {
        const cfg = this.store.get();
        const provider = cfg.providers.find((p) => p.id === cfg.activeProviderId) || cfg.providers[0];
        if (!provider)
            throw new Error('没有可用的 AI 模型，请先在设置中配置');
        const contract = await (0, contract_1.readContract)(this.vault.getVaultPath());
        // 已有分析要求 tag：注入 prompt 让新 tag 优先复用既有名称（复用闭环）
        const existingTags = await this.vault.getAnalysisTags();
        const results = [];
        const newTags = [];
        const confirmHighMap = new Map();
        const imports = [];
        for (const p of filePaths) {
            const name = p.split(/[\\/]/).pop() || p;
            try {
                const relPath = await this.vault.importFile(p);
                this.recentIngests.set(relPath, Date.now());
                imports.push({ name, path: p, relPath });
            }
            catch (e) {
                results.push({ name, ingestError: e instanceof Error ? e.message : String(e) });
            }
        }
        for (const item of imports) {
            const { name, relPath } = item;
            try {
                const ingestResult = await this.runIngest(relPath);
                for (const c of ingestResult.confirmHigh ?? []) {
                    const prev = confirmHighMap.get(c.slug);
                    if (!prev || c.sourceCount > prev.sourceCount)
                        confirmHighMap.set(c.slug, c);
                }
                const fileResult = {
                    name, relPath, sourcePath: ingestResult.sourcePath
                };
                if (requirement.trim()) {
                    try {
                        this.emitCustomProgress({ file: name, stage: '定制分析…', percent: 90 });
                        const note = await this.vault.readNote(ingestResult.sourcePath);
                        const analysis = await this.pipeline.customAnalyze(provider, note.title, note.rawBody, requirement.trim(), contract, existingTags);
                        await this.vault.appendCustomAnalysis(ingestResult.sourcePath, requirement.trim(), analysis.report);
                        await this.indexOne(ingestResult.sourcePath);
                        this.bus.push('vaultChanged', { type: 'modify', path: ingestResult.sourcePath });
                        this.emitCustomProgress({ file: name, stage: '归纳分析 tag…', percent: 95 });
                        fileResult.analysis = analysis;
                        if (analysis.analysisTags.length)
                            newTags.push(...analysis.analysisTags);
                        this.emitCustomProgress({ file: name, stage: '完成', percent: 100, done: true });
                    }
                    catch (e) {
                        fileResult.analysisError = e instanceof Error ? e.message : String(e);
                        this.emitCustomProgress({ file: name, stage: '完成', percent: 100, done: true });
                    }
                }
                results.push(fileResult);
            }
            catch (e) {
                results.push({ name, relPath, ingestError: e instanceof Error ? e.message : String(e) });
            }
        }
        let addedTags = [];
        if (newTags.length) {
            const before = new Set((await this.vault.getAnalysisTags()).map((t) => t.tag));
            await this.vault.addAnalysisTags(newTags);
            addedTags = newTags.filter((t) => !before.has(t.tag));
        }
        return { files: results, newTags: addedTags, confirmHigh: Array.from(confirmHighMap.values()) };
    }
    /** 浏览器上传：写入 raw/uploaded/<name> 并立即 INGEST（可选定制分析） */
    async uploadAndIngest(name, buf, requirement) {
        const safeName = (name || 'upload').replace(/[\\/:*?"<>|]/g, '_');
        const relPath = `raw/uploaded/${Date.now()}-${safeName}`;
        const absPath = path_1.default.join(this.vault.getVaultPath(), relPath);
        await fs_1.promises.mkdir(path_1.default.dirname(absPath), { recursive: true });
        await fs_1.promises.writeFile(absPath, buf);
        this.recentIngests.set(relPath, Date.now());
        return this.importAnalyze([absPath], requirement || '');
    }
    // ──────────────────────── 概念 / tags / 附件 / 批注 ────────────────────────
    async conceptConfirm(slug, area) {
        const absPath = path_1.default.join(this.vault.getVaultPath(), 'wiki', area, `${slug}.md`);
        try {
            const raw = await fs_1.promises.readFile(absPath, 'utf-8');
            const parsed = (0, gray_matter_1.default)(raw);
            const fm = parsed.data;
            fm.confidence = 'high';
            fm.last_reviewed = new Date().toISOString().slice(0, 10);
            await fs_1.promises.writeFile(absPath, gray_matter_1.default.stringify(parsed.content, fm), 'utf-8');
            await this.vault.appendLog(`confidence | ${area}/${slug} 已确认为 high（用户背书）`);
            await this.indexOne(`wiki/${area}/${slug}.md`);
            return { ok: true };
        }
        catch {
            return { ok: false, error: `页面不存在: wiki/${area}/${slug}.md` };
        }
    }
    getAnalysisTags() {
        return this.vault.getAnalysisTags();
    }
    async addAnalysisTags(tags) {
        const merged = await this.vault.addAnalysisTags(tags);
        if (tags.length > 0)
            await this.vault.appendLog(`analysis-tags | 新增 ${tags.length} 个分析要求 tag`);
        return merged;
    }
    listAttachments(subDir) {
        return this.vault.listAttachments(subDir);
    }
    addAnnotation(relPath, text, range) {
        return this.vault.addAnnotation(relPath, text, range);
    }
    removeAnnotation(relPath, annotationId) {
        return this.vault.removeAnnotation(relPath, annotationId);
    }
    getVaultPath() {
        return this.vault.getVaultPath();
    }
    async setVaultPath(p) {
        if (this.ingestion.active)
            throw new Error('请先停止当前知识整理任务再切换知识库');
        await this.search.rebuild([]);
        await this.vault.setVaultPath(p);
        await this.indexWikiVault();
        for (const source of await this.workspace.sources())
            this.ingestion.index(source);
        await this.rebuildGraph();
    }
}
exports.WikiHost = WikiHost;
