"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServerHost = createServerHost;
/**
 * DSH 插件 HTTP 宿主：把 window.winagent 的 IPC 表面映射为 /winagent/api/*，
 * 代理事件通过长轮询 JSON 流推送，UI 与静态资源从本包 assets 提供。
 * @module dsh-winagent/server
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const ConfigStore_1 = require("./config/ConfigStore");
const wiki_host_1 = require("./wiki/wiki-host");
const wikiTools_1 = require("./tools/wikiTools");
const OpenAIClient_1 = require("./llm/OpenAIClient");
const Logger_1 = require("./util/Logger");
const platform_1 = require("./platform");
const JSON_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
};
function createServerHost(ctx, store, registry, agent, bus) {
    let wikiHost = null;
    let ready = Promise.resolve();
    const pendingConfirms = new Map();
    let confirmSeq = 0;
    let disposed = false;
    // ──────────────────────── 初始化 ────────────────────────
    function resolveSkillsDir(cfg) {
        const p = cfg.skillsDir || 'skills';
        const abs = path_1.default.isAbsolute(p) ? p : path_1.default.join((0, ConfigStore_1.getDataDir)(), p);
        return abs;
    }
    async function seedDataDir() {
        const dir = (0, ConfigStore_1.getDataDir)();
        await fs_1.promises.mkdir(dir, { recursive: true });
        // skills：首次使用从插件自带资源播种（pdf/docx/pptx/xlsx 读取器 + 示例 skill）
        const skillsDir = path_1.default.join(dir, 'skills');
        const bundled = path_1.default.join(platform_1.PACKAGE_ROOT, 'assets', 'skills');
        try {
            const existing = await fs_1.promises.readdir(skillsDir);
            if (existing.length === 0)
                throw new Error('empty');
        }
        catch {
            await fs_1.promises.mkdir(skillsDir, { recursive: true });
            await copyDir(bundled, skillsDir);
        }
        // mcp.json：写入默认模板（两个 disabled 示例）
        const mcpPath = path_1.default.join(dir, 'mcp.json');
        try {
            await fs_1.promises.access(mcpPath);
        }
        catch {
            await fs_1.promises.writeFile(mcpPath, JSON.stringify({
                mcpServers: {
                    _example_filesystem: {
                        disabled: true,
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users']
                    },
                    _example_http: { disabled: true, url: 'http://localhost:8000/mcp' }
                }
            }, null, 2), 'utf-8');
        }
    }
    async function copyDir(src, dst) {
        const entries = await fs_1.promises.readdir(src, { withFileTypes: true });
        for (const e of entries) {
            const s = path_1.default.join(src, e.name);
            const d = path_1.default.join(dst, e.name);
            if (e.isDirectory()) {
                await fs_1.promises.mkdir(d, { recursive: true });
                await copyDir(s, d);
            }
            else {
                await fs_1.promises.copyFile(s, d);
            }
        }
    }
    async function reloadTools() {
        const cfg = store.get();
        await registry.initialize(cfg);
        const skillsDir = resolveSkillsDir(cfg);
        const mcpPath = path_1.default.isAbsolute(cfg.mcpConfigPath || 'mcp.json')
            ? cfg.mcpConfigPath
            : path_1.default.join((0, ConfigStore_1.getDataDir)(), cfg.mcpConfigPath || 'mcp.json');
        await registry.loadExternal(skillsDir, mcpPath);
    }
    async function init() {
        await seedDataDir();
        const cfg = await store.load();
        wikiHost = new wiki_host_1.WikiHost(store, bus);
        await wikiHost.init();
        registry.setWikiTools((0, wikiTools_1.createWikiTools)(wikiHost.vault, wikiHost.search, store));
        await registry.initialize(cfg);
        await reloadTools();
        Logger_1.Logger.info('dsh-winagent 启动完成，数据目录: ' + (0, ConfigStore_1.getDataDir)());
        ctx.logger?.info?.('dsh-winagent mounted (data: ' + (0, ConfigStore_1.getDataDir)() + ')');
    }
    // ──────────────────────── Agent 宿主 ────────────────────────
    function confirmTool(name, args) {
        return new Promise((resolve) => {
            const id = `cf_${++confirmSeq}`;
            pendingConfirms.set(id, resolve);
            bus.push('confirm', { id, name, args });
        });
    }
    async function agentSend(text, attachments) {
        await agent.process(text, {
            onEvent: (e) => bus.push('agentEvent', e),
            confirmTool,
        }, attachments);
    }
    function clearPendingConfirms(approved) {
        for (const [id, resolve] of [...pendingConfirms]) {
            pendingConfirms.delete(id);
            resolve(approved);
        }
    }
    // ──────────────────────── HTTP 辅助 ────────────────────────
    function json(res, status, obj) {
        res.writeHead(status, JSON_HEADERS);
        res.end(JSON.stringify(obj));
    }
    function readBody(req, limit) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            req.on('data', (c) => {
                size += c.length;
                if (size > limit) {
                    reject(new Error('body too large'));
                    req.destroy();
                    return;
                }
                chunks.push(c);
            });
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });
    }
    async function readJson(req) {
        const buf = await readBody(req, 2 * 1024 * 1024);
        return buf.length ? JSON.parse(buf.toString('utf-8')) : {};
    }
    function pathnameOf(req) {
        try {
            return new URL(req.url ?? '/', 'http://x').pathname;
        }
        catch {
            return '/';
        }
    }
    function queryOf(req) {
        try {
            return new URL(req.url ?? '/', 'http://x').searchParams;
        }
        catch {
            return new URLSearchParams();
        }
    }
    // ──────────────────────── 静态资源 ────────────────────────
    async function serveAsset(req, res, rel) {
        const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
        if (clean.split('/').includes('..')) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('forbidden');
            return;
        }
        const abs = path_1.default.resolve(platform_1.PACKAGE_ROOT, 'assets', clean);
        if (!abs.startsWith(path_1.default.resolve(platform_1.PACKAGE_ROOT, 'assets') + path_1.default.sep)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('forbidden');
            return;
        }
        try {
            const buf = await fs_1.promises.readFile(abs);
            const ext = path_1.default.extname(abs).toLowerCase();
            const types = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.mp3': 'audio/mpeg',
                '.ico': 'image/x-icon',
            };
            res.writeHead(200, {
                'Content-Type': types[ext] || 'application/octet-stream',
                'Content-Length': String(buf.length),
                'Cache-Control': 'no-store',
            });
            res.end(buf);
        }
        catch {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
        }
    }
    async function serveUiIndex(res) {
        try {
            const html = await fs_1.promises.readFile(path_1.default.join(platform_1.PACKAGE_ROOT, 'assets', 'ui', 'index.html'), 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(html);
        }
        catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('ui unavailable: ' + String(e?.message || e));
        }
    }
    // ──────────────────────── API ────────────────────────
    /** file:read 移植（附件读取：图片→dataUrl，文本→内容，其他→路径信息） */
    async function apiFileRead(res, filePath) {
        try {
            const ext = path_1.default.extname(filePath).toLowerCase();
            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
            const mimeMap = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
            };
            const mime = mimeMap[ext] || 'application/octet-stream';
            const name = path_1.default.basename(filePath);
            if (imageExts.includes(ext)) {
                const buf = await fs_1.promises.readFile(filePath);
                const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
                json(res, 200, { name, path: filePath, mime, isImage: true, dataUrl });
                return;
            }
            const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.java',
                '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat'];
            if (textExts.includes(ext)) {
                const textContent = await fs_1.promises.readFile(filePath, 'utf-8');
                json(res, 200, { name, path: filePath, mime, isImage: false, textContent: textContent.slice(0, 50000) });
                return;
            }
            json(res, 200, { name, path: filePath, mime, isImage: false });
        }
        catch (e) {
            json(res, 500, { error: String(e?.message || e) });
        }
    }
    /** [method, regex, handler] 表：首个匹配生效 */
    function apiRoutes() {
        const wiki = () => {
            if (!wikiHost)
                throw new Error('Wiki 未初始化');
            return wikiHost;
        };
        const routes = [
            ['GET', /^\/winagent\/api\/config$/, async (_req, res) => json(res, 200, store.get())],
            ['POST', /^\/winagent\/api\/config$/, async (req, res) => {
                    const cfg = await readJson(req);
                    await store.save(cfg);
                    await reloadTools();
                    const saved = store.get();
                    bus.push('configChanged', saved);
                    json(res, 200, saved);
                }],
            ['GET', /^\/winagent\/api\/data-dir$/, (_req, res) => json(res, 200, { dir: (0, ConfigStore_1.getDataDir)() })],
            ['GET', /^\/winagent\/api\/tools$/, (_req, res) => json(res, 200, registry.getInfos())],
            ['POST', /^\/winagent\/api\/tools\/reload$/, async (_req, res) => {
                    await reloadTools();
                    json(res, 200, registry.getInfos());
                }],
            ['GET', /^\/winagent\/api\/models$/, async (req, res, q) => {
                    try {
                        const cfg = store.get();
                        const provider = cfg.providers.find((p) => p.id === q.get('providerId')) || store.activeProvider();
                        json(res, 200, await (0, OpenAIClient_1.fetchModels)(provider));
                    }
                    catch (e) {
                        json(res, 200, { error: String(e?.message || e) });
                    }
                }],
            ['GET', /^\/winagent\/api\/file\/read$/, async (req, res, q) => apiFileRead(res, q.get('path') || '')],
            ['POST', /^\/winagent\/api\/agent\/send$/, async (req, res) => {
                    const body = await readJson(req);
                    void agentSend(String(body.text ?? ''), body.attachments).catch((e) => {
                        bus.push('agentEvent', { type: 'error', message: String(e?.message || e) });
                    });
                    json(res, 200, { ok: true });
                }],
            ['POST', /^\/winagent\/api\/agent\/stop$/, (_req, res) => {
                    agent.stop();
                    clearPendingConfirms(false);
                    json(res, 200, { ok: true });
                }],
            ['POST', /^\/winagent\/api\/agent\/reset$/, (_req, res) => {
                    agent.reset();
                    clearPendingConfirms(false);
                    json(res, 200, { ok: true });
                }],
            ['POST', /^\/winagent\/api\/agent\/compact$/, async (_req, res) => {
                    await agent.compactNow({
                        onEvent: (e) => bus.push('agentEvent', e),
                        confirmTool,
                    });
                    json(res, 200, { ok: true });
                }],
            ['POST', /^\/winagent\/api\/agent\/confirm$/, async (req, res) => {
                    const body = await readJson(req);
                    const resolve = pendingConfirms.get(String(body.id ?? ''));
                    if (resolve) {
                        pendingConfirms.delete(String(body.id ?? ''));
                        resolve(!!body.approved);
                    }
                    json(res, 200, { ok: true });
                }],
            ['GET', /^\/winagent\/api\/agent\/events$/, async (req, res, q) => {
                    const seq = Number(q.get('seq')) || 0;
                    const events = await bus.waitSince(seq, 25000);
                    json(res, 200, { events });
                }],
            // ── Wiki ──
            ['GET', /^\/winagent\/api\/wiki\/vault-path$/, (_req, res) => json(res, 200, { path: wiki().getVaultPath() })],
            ['POST', /^\/winagent\/api\/wiki\/vault-path$/, async (req, res) => {
                    const body = await readJson(req);
                    await wiki().setVaultPath(String(body.path ?? ''));
                    json(res, 200, { ok: true });
                }],
            ['GET', /^\/winagent\/api\/wiki\/notes$/, async (_req, res) => json(res, 200, await wiki().listNotes())],
            ['GET', /^\/winagent\/api\/wiki\/note$/, async (req, res, q) => {
                    try {
                        json(res, 200, await wiki().readNote(q.get('path') || ''));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/note$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        await wiki().writeNote(String(body.path ?? ''), body.data);
                        json(res, 200, { ok: true });
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/note\/delete$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        await wiki().deleteNote(String(body.path ?? ''));
                        json(res, 200, { ok: true });
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/note\/create$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        await wiki().createNote(String(body.path ?? ''), String(body.title ?? ''));
                        json(res, 200, { ok: true });
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['GET', /^\/winagent\/api\/wiki\/backlinks$/, async (req, res, q) => json(res, 200, await wiki().getBacklinks(q.get('path') || ''))],
            ['GET', /^\/winagent\/api\/wiki\/tags$/, async (_req, res) => json(res, 200, await wiki().getAllTags())],
            ['GET', /^\/winagent\/api\/wiki\/tags\/notes$/, async (req, res, q) => json(res, 200, await wiki().getNotesByTag(q.get('tag') || ''))],
            ['GET', /^\/winagent\/api\/wiki\/search$/, async (req, res, q) => json(res, 200, wiki().searchNotes(q.get('q') || '', Number(q.get('limit')) || 10))],
            ['GET', /^\/winagent\/api\/wiki\/graph$/, (_req, res) => json(res, 200, wiki().getGraphData())],
            ['GET', /^\/winagent\/api\/wiki\/graph\/node$/, (req, res, q) => json(res, 200, wiki().getGraphNode(q.get('id') || ''))],
            ['POST', /^\/winagent\/api\/wiki\/graph\/rebuild$/, async (_req, res) => { await wiki().rebuildGraph(); json(res, 200, { ok: true }); }],
            ['POST', /^\/winagent\/api\/wiki\/ai\/analyze$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().aiAnalyze(String(body.relPath ?? '')));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/ai\/cancel$/, (_req, res) => { wiki().aiCancel(); json(res, 200, { ok: true }); }],
            ['POST', /^\/winagent\/api\/wiki\/ingest$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().runIngest(String(body.rawRelPath ?? '')));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/ingest\/batch-start$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().ingestBatchStart(body.paths ?? []));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/ingest\/batch-continue$/, async (_req, res) => {
                    try {
                        json(res, 200, await wiki().ingestBatchContinue());
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/ingest\/batch-abort$/, async (_req, res) => json(res, 200, await wiki().ingestBatchAbort())],
            ['POST', /^\/winagent\/api\/wiki\/workflow\/lint$/, async (_req, res) => {
                    try {
                        json(res, 200, await wiki().workflowLint());
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/workflow\/reflect$/, async (_req, res) => {
                    try {
                        json(res, 200, await wiki().workflowReflect());
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/workflow\/merge$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().workflowMerge(String(body.keep ?? ''), String(body.remove ?? ''), String(body.area ?? '')));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/workflow\/query$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().workflowQuery(String(body.query ?? '')));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/import\/url$/, async (req, res) => {
                    const body = await readJson(req);
                    json(res, 200, await wiki().importUrl(String(body.url ?? '')));
                }],
            ['POST', /^\/winagent\/api\/wiki\/import\/file$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, { relPath: await wiki().importFile(String(body.srcPath ?? ''), body.targetDir) });
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/import\/analyze$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().importAnalyze(body.filePaths ?? [], String(body.requirement ?? '')));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/upload$/, async (req, res, q) => {
                    try {
                        const buf = await readBody(req, 100 * 1024 * 1024);
                        const name = q.get('name') || 'upload.bin';
                        const requirement = q.get('requirement') || '';
                        json(res, 200, await wiki().uploadAndIngest(name, buf, requirement));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['GET', /^\/winagent\/api\/wiki\/analysis-tags$/, async (_req, res) => json(res, 200, await wiki().getAnalysisTags())],
            ['POST', /^\/winagent\/api\/wiki\/analysis-tags$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().addAnalysisTags(body.tags ?? []));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['GET', /^\/winagent\/api\/wiki\/attachments$/, async (req, res, q) => json(res, 200, await wiki().listAttachments(q.get('sub') || undefined))],
            ['POST', /^\/winagent\/api\/wiki\/annotations\/add$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        json(res, 200, await wiki().addAnnotation(String(body.relPath ?? ''), String(body.text ?? ''), String(body.range ?? '')));
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/annotations\/remove$/, async (req, res) => {
                    const body = await readJson(req);
                    try {
                        await wiki().removeAnnotation(String(body.relPath ?? ''), String(body.annotationId ?? ''));
                        json(res, 200, { ok: true });
                    }
                    catch (e) {
                        json(res, 500, { error: String(e?.message || e) });
                    }
                }],
            ['POST', /^\/winagent\/api\/wiki\/concept\/confirm$/, async (req, res) => {
                    const body = await readJson(req);
                    json(res, 200, await wiki().conceptConfirm(String(body.slug ?? ''), body.area === 'entities' ? 'entities' : 'concepts'));
                }],
        ];
        return routes;
    }
    // ──────────────────────── 路由注册 ────────────────────────
    const FLOAT_BTN_JS = `(function(){
    if (window.__dshWinagentBtn) return
    window.__dshWinagentBtn = true
    var btn = document.createElement('button')
    btn.textContent = 'WinAgent'
    btn.title = '打开/关闭 WinAgent（Windows 操作 Agent）'
    btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99999;padding:9px 16px;border:0;border-radius:10px;background:linear-gradient(135deg,#4f8ef7,#7a5cf0);color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28)'
    var frame = null
    btn.addEventListener('click', function () {
      if (frame) { frame.remove(); frame = null; btn.textContent = 'WinAgent'; return }
      frame = document.createElement('iframe')
      frame.src = '/winagent/ui'
      frame.style.cssText = 'position:fixed;right:0;top:0;bottom:0;width:960px;max-width:100vw;z-index:99998;border:0;background:#fff'
      document.body.appendChild(frame)
      btn.textContent = '关闭 WinAgent'
    })
    function mount(){ if (document.body) { document.body.appendChild(btn); return } setTimeout(mount, 50) }
    mount()
  })()`;
    function registerRoutes(webServer) {
        if (!webServer)
            return;
        const disposers = [];
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/winagent/ui',
            handler: (_req, res) => { void serveUiIndex(res); },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/winagent/',
            handler: (_req, res) => {
                res.writeHead(302, { Location: '/winagent/ui' });
                res.end();
            },
        }));
        disposers.push(webServer.register({
            kind: 'prefix',
            path: '/winagent/assets',
            handler: (req, res) => {
                const rel = pathnameOf(req).slice('/winagent/assets'.length);
                void serveAsset(req, res, rel);
            },
        }));
        disposers.push(webServer.register({
            kind: 'prefix',
            path: '/winagent/api',
            handler: (req, res) => {
                const p = pathnameOf(req);
                const q = queryOf(req);
                for (const [method, pattern, handler] of apiRoutes()) {
                    if (req.method === method && pattern.test(p)) {
                        void (async () => {
                            try {
                                await handler(req, res, q);
                            }
                            catch (e) {
                                if (!res.headersSent) {
                                    json(res, 500, { error: String(e?.message || e) });
                                }
                                else {
                                    res.destroy();
                                }
                            }
                        })();
                        return;
                    }
                }
                json(res, 404, { error: 'unknown api: ' + req.method + ' ' + p });
            },
        }));
        if (typeof webServer.tapIndex === 'function') {
            disposers.push(webServer.tapIndex((html) => {
                if (html.indexOf('/winagent/ui') !== -1 || html.indexOf('__dshWinagentBtn') !== -1)
                    return html;
                const tag = '<script>(' + FLOAT_BTN_JS + ')();</script>';
                if (html.indexOf('</body>') !== -1)
                    return html.replace('</body>', tag + '</body>');
                return html + tag;
            }));
        }
        ctx.effect(() => () => {
            for (const d of disposers) {
                try {
                    d();
                }
                catch { /* ignore */ }
            }
        });
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        clearPendingConfirms(false);
        wikiHost?.dispose();
        registry.dispose();
    }
    ready = init();
    return { init: () => ready, registerRoutes, dispose };
}
