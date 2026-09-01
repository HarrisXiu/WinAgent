"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultManager = exports.INGESTIBLE_EXTS = exports.SYSTEM_FILES = exports.WIKI_SUBDIRS = exports.RAW_SUBDIRS = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const contract_1 = require("./contract");
/** LLM Wiki 分层目录结构（raw 人类所有 / wiki LLM 编译层 / outputs 输出） */
exports.RAW_SUBDIRS = ['articles', 'clippings', 'images', 'pdfs', 'notes', 'personal'];
exports.WIKI_SUBDIRS = ['sources', 'concepts', 'entities', 'synthesis', 'templates', 'outputs'];
exports.SYSTEM_FILES = ['index.md', 'log.md', 'overview.md', 'QUESTIONS.md', 'ANALYSIS_TAGS.md'];
/** INGEST 管线可处理的文件扩展名（与 runIngest 中的分类一致） */
exports.INGESTIBLE_EXTS = [
    '.md', '.txt', '.markdown', '.json', '.js', '.ts', '.tsx', '.jsx', '.py',
    '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat',
    '.pdf', '.pptx', '.docx', '.xlsx', '.xlsm', '.ppt', '.doc', '.xls',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'
];
class VaultManager {
    vaultPath;
    notesDir;
    attachmentsDir;
    rawDir;
    wikiDir;
    outputsDir;
    changeCallbacks = [];
    watcher = null;
    constructor(vaultPath) {
        this.vaultPath = path_1.default.resolve(vaultPath);
        this.notesDir = this.vaultPath;
        this.attachmentsDir = path_1.default.join(this.vaultPath, 'attachments');
        this.rawDir = path_1.default.join(this.vaultPath, 'raw');
        this.wikiDir = path_1.default.join(this.vaultPath, 'wiki');
        this.outputsDir = path_1.default.join(this.vaultPath, 'outputs');
    }
    getVaultPath() {
        return this.vaultPath;
    }
    getRawDir() {
        return this.rawDir;
    }
    getWikiDir() {
        return this.wikiDir;
    }
    async initialize() {
        await fs_1.promises.mkdir(this.notesDir, { recursive: true });
        await fs_1.promises.mkdir(this.attachmentsDir, { recursive: true });
        // LLM Wiki 分层目录
        await Promise.all(exports.RAW_SUBDIRS.map((d) => fs_1.promises.mkdir(path_1.default.join(this.rawDir, d), { recursive: true })));
        await Promise.all(exports.WIKI_SUBDIRS.map((d) => fs_1.promises.mkdir(path_1.default.join(this.wikiDir, d), { recursive: true })));
        await fs_1.promises.mkdir(path_1.default.join(this.wikiDir, 'templates'), { recursive: true });
        await fs_1.promises.mkdir(path_1.default.join(this.wikiDir, 'outputs'), { recursive: true });
        await fs_1.promises.mkdir(this.outputsDir, { recursive: true });
        // 创建系统文件（若不存在）
        await this.ensureSystemFiles();
        // 创建页面模板
        await this.ensureTemplates();
        this.startWatching();
    }
    /** 判断是否为系统文件（index/log/overview/QUESTIONS/CLAUDE.md，不参与图谱） */
    isSystemFile(relPath) {
        const normalized = relPath.replace(/\\/g, '/');
        return (exports.SYSTEM_FILES.some((f) => normalized === `wiki/${f}`) ||
            normalized.startsWith('wiki/outputs/') ||
            normalized === 'CLAUDE.md' ||
            normalized === 'USER_GUIDE.md');
    }
    /** 追加一个开放问题到 wiki/QUESTIONS.md */
    async addQuestion(question) {
        const qPath = path_1.default.join(this.wikiDir, 'QUESTIONS.md');
        const line = `- [ ] ${question}（opened ${new Date().toISOString().slice(0, 10)}）`;
        try {
            const raw = await fs_1.promises.readFile(qPath, 'utf-8');
            const parsed = (0, gray_matter_1.default)(raw);
            // 追加到 Open Questions 段末
            let body = parsed.content;
            const marker = '## Open Questions';
            if (body.includes(marker)) {
                const idx = body.indexOf(marker);
                const rest = body.slice(idx + marker.length);
                // 找下一段标题
                const nextSection = rest.search(/\n## /);
                const insertAt = nextSection > -1 ? idx + marker.length + nextSection : body.length;
                body = body.slice(0, insertAt) + (body.slice(insertAt).startsWith('\n\n') ? '' : '\n\n') + line + body.slice(insertAt);
            }
            else {
                body += `\n## Open Questions\n\n${line}\n`;
            }
            const fm = { ...parsed.data };
            const content = gray_matter_1.default.stringify(body, fm);
            await fs_1.promises.writeFile(qPath, content, 'utf-8');
        }
        catch {
            // QUESTIONS.md 不存在时创建
            const body = `# 开放问题队列\n\n## Open Questions\n\n${line}\n\n## Resolved Questions\n\n（暂无）\n`;
            await fs_1.promises.writeFile(qPath, gray_matter_1.default.stringify(body, { type: 'system-questions', 'graph-excluded': true }), 'utf-8');
        }
    }
    /** 读取 QUESTIONS.md 中的开放问题列表 */
    async getOpenQuestions() {
        const qPath = path_1.default.join(this.wikiDir, 'QUESTIONS.md');
        try {
            const raw = await fs_1.promises.readFile(qPath, 'utf-8');
            const parsed = (0, gray_matter_1.default)(raw);
            return parsed.content
                .split('\n')
                .filter((l) => l.trim().startsWith('- [ ]'))
                .map((l) => l.trim().replace(/^- \[ \]\s*/, '').replace(/（opened.*$/, ''));
        }
        catch {
            return [];
        }
    }
    /** 将开放问题移入 Answered（INGEST 匹配到答案时） */
    async answerQuestion(question) {
        const qPath = path_1.default.join(this.wikiDir, 'QUESTIONS.md');
        try {
            const raw = await fs_1.promises.readFile(qPath, 'utf-8');
            const parsed = (0, gray_matter_1.default)(raw);
            let body = parsed.content;
            const open = body.split('\n').filter((l) => l.trim().startsWith('- [ ]'));
            const target = open.find((l) => l.includes(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 30)));
            if (!target)
                return;
            body = body.replace(target, target.replace('- [ ]', '- [x]').replace('（opened', '（answered ' + new Date().toISOString().slice(0, 10) + ', opened'));
            await fs_1.promises.writeFile(qPath, gray_matter_1.default.stringify(body, parsed.data), 'utf-8');
        }
        catch { /* ignore */ }
    }
    /** 读取分析要求 Tag 列表（wiki/ANALYSIS_TAGS.md 的 Tags 段，逐行 `- 标签 | 模板`） */
    async getAnalysisTags() {
        const tPath = path_1.default.join(this.wikiDir, 'ANALYSIS_TAGS.md');
        try {
            const raw = await fs_1.promises.readFile(tPath, 'utf-8');
            const parsed = (0, gray_matter_1.default)(raw);
            return parsed.content
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.startsWith('- '))
                .map((l) => {
                const body = l.slice(2);
                const sep = body.indexOf('|');
                if (sep < 0)
                    return null;
                const tag = body.slice(0, sep).trim();
                const template = body.slice(sep + 1).trim();
                return tag && template ? { tag, template } : null;
            })
                .filter((t) => t !== null);
        }
        catch {
            return [];
        }
    }
    /** 合并写入分析要求 Tag（按 tag 字符串去重），返回合并后全量 */
    async addAnalysisTags(tags) {
        const tPath = path_1.default.join(this.wikiDir, 'ANALYSIS_TAGS.md');
        const existing = await this.getAnalysisTags();
        const seen = new Set(existing.map((t) => t.tag));
        for (const t of tags) {
            if (!t?.tag || !t?.template || seen.has(t.tag))
                continue;
            seen.add(t.tag);
            existing.push(t);
        }
        const lines = existing.map((t) => `- ${t.tag} | ${t.template}`).join('\n');
        const body = `# 分析要求 Tag 模板\n\n> 系统维护：AI 归纳用户的分析要求形成可复用 tag，拖拽导入弹窗中可选。用户可自由编辑/删除。\n\n## Tags\n\n${lines || '（暂无）'}\n`;
        await fs_1.promises.writeFile(tPath, gray_matter_1.default.stringify(body, { type: 'system-analysis-tags', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8');
        return existing;
    }
    /** 把定制分析报告追加到 source 页正文末尾（## Custom Analysis 区块），frontmatter 记录要求与时间 */
    async appendCustomAnalysis(sourceRelPath, requirement, report) {
        const sPath = path_1.default.join(this.vaultPath, sourceRelPath);
        const raw = await fs_1.promises.readFile(sPath, 'utf-8');
        const parsed = (0, gray_matter_1.default)(raw);
        const section = `\n\n## Custom Analysis\n\n> 分析要求: ${requirement}\n\n${report.trim()}\n`;
        const body = parsed.content.trimEnd() + section;
        const fm = {
            ...parsed.data,
            custom_analyzed_at: new Date().toISOString(),
            custom_requirement: requirement
        };
        await fs_1.promises.writeFile(sPath, gray_matter_1.default.stringify(body, fm), 'utf-8');
    }
    /** 更新 wiki/overview.md 的 Health Dashboard */
    async updateOverview(stats) {
        const oPath = path_1.default.join(this.wikiDir, 'overview.md');
        const rows = Object.entries(stats).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
        const body = [
            `# 知识库综述`,
            ``,
            `## Knowledge Base Health Dashboard`,
            ``,
            `| 指标 | 数值 |`,
            `|---|---|`,
            rows,
            ``,
            `> 由系统维护：INGEST 后更新来源数，REFLECT 后更新综合分析指标。`,
            ``
        ].join('\n');
        await fs_1.promises.writeFile(oPath, gray_matter_1.default.stringify(body, { type: 'system-overview', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8');
    }
    /** 判断文件是否属于 raw 层（只读区） */
    isRawPath(relPath) {
        return relPath.replace(/\\/g, '/').startsWith('raw/');
    }
    /** 追加一行操作日志到 wiki/log.md */
    async appendLog(entry) {
        const logPath = path_1.default.join(this.wikiDir, 'log.md');
        const line = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${entry}`;
        try {
            const raw = await fs_1.promises.readFile(logPath, 'utf-8');
            await fs_1.promises.writeFile(logPath, raw.endsWith('\n') ? `${raw}${line}\n` : `${raw}\n${line}\n`, 'utf-8');
        }
        catch {
            // log.md 不存在（初始化失败时兜底）
        }
    }
    /** 重建 wiki/index.md 的列表段（Sources/Concepts/Entities） */
    async updateIndex(sources, concepts, entities) {
        const fm = {
            type: 'system-index',
            'graph-excluded': true,
            updated: new Date().toISOString()
        };
        const renderList = (items, header) => {
            const lines = items.map((i) => `- [[${i.slug}]] — ${i.title}`);
            return `## ${header}\n\n${lines.length ? lines.join('\n') : '（暂无）'}`;
        };
        const body = [
            `# 知识库索引`,
            ``,
            `本文件由系统自动维护，记录知识库编译层的全部页面。`,
            ``,
            renderList(sources, 'Sources'),
            ``,
            renderList(concepts, 'Concepts'),
            ``,
            renderList(entities, 'Entities'),
            ``
        ].join('\n');
        const content = gray_matter_1.default.stringify(body, fm);
        await fs_1.promises.writeFile(path_1.default.join(this.wikiDir, 'index.md'), content, 'utf-8');
    }
    async ensureSystemFiles() {
        const indexPath = path_1.default.join(this.wikiDir, 'index.md');
        try {
            await fs_1.promises.access(indexPath);
        }
        catch {
            await fs_1.promises.writeFile(indexPath, gray_matter_1.default.stringify('# 知识库索引\n\n本文件由系统自动维护。', { type: 'system-index', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8');
        }
        const logPath = path_1.default.join(this.wikiDir, 'log.md');
        try {
            await fs_1.promises.access(logPath);
        }
        catch {
            await fs_1.promises.writeFile(logPath, gray_matter_1.default.stringify('# 操作日志\n\n仅追加。格式：YYYY-MM-DD HH:MM | 操作类型 | 说明', { type: 'system-log', 'graph-excluded': true }), 'utf-8');
        }
        const questionsPath = path_1.default.join(this.wikiDir, 'QUESTIONS.md');
        try {
            await fs_1.promises.access(questionsPath);
        }
        catch {
            await fs_1.promises.writeFile(questionsPath, gray_matter_1.default.stringify('# 开放问题队列\n\n## Open Questions\n\n（暂无）\n\n## Resolved Questions\n\n（暂无）', { type: 'system-questions', 'graph-excluded': true }), 'utf-8');
        }
        const overviewPath = path_1.default.join(this.wikiDir, 'overview.md');
        try {
            await fs_1.promises.access(overviewPath);
        }
        catch {
            await fs_1.promises.writeFile(overviewPath, gray_matter_1.default.stringify('# 知识库综述\n\n## Knowledge Base Health Dashboard\n\n| 指标 | 数值 |\n|---|---|\n| 总来源数 | 0 |\n| 概念数 | 0 |\n| 开放问题数 | 0 |', { type: 'system-overview', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8');
        }
        // 行为契约：vault 根 CLAUDE.md（用户可编辑，管线每次摄入时读盘注入）
        const contractPath = path_1.default.join(this.vaultPath, 'CLAUDE.md');
        try {
            await fs_1.promises.access(contractPath);
        }
        catch {
            await fs_1.promises.writeFile(contractPath, contract_1.WINAGENT_CONTRACT_MD, 'utf-8');
        }
        // 用户指南：CLAUDE.md 的配套文档（契约修订时同步追加变更记录）
        const guidePath = path_1.default.join(this.vaultPath, 'USER_GUIDE.md');
        try {
            await fs_1.promises.access(guidePath);
        }
        catch {
            await fs_1.promises.writeFile(guidePath, gray_matter_1.default.stringify(`# WinAgent 知识库使用指南

## 入口
- 主窗口顶栏「知识库浏览器」按钮 → 弹出独立知识库窗口（可拖拽文件批量摄入）。
- 知识库窗口顶部工具栏：批量摄入 / AI 问答 / 健康检查 / 综合分析 / 去重合并 / 开放问题 / URL 导入。

## 日常流程
1. 阅读文章 → 拖入知识库窗口（或点击「批量摄入」选择文件）。
2. 多文件批量摄入会先编译 1 篇供审查（AI 编译内容 + 原文对照），确认质量后继续。
3. 对编译质量不满意 → 点击「调整契约规则」编辑 CLAUDE.md，保存后继续批量即生效。
4. 定期点击「健康检查」查看知识库状态（SOURCE MODIFIED 可一键重新摄入）。
5. 每月点击「综合分析」发现跨来源模式与内容空白。

## 规则
- 全部行为规则见根目录 CLAUDE.md（本文件的配套契约，由用户维护）。
- CLAUDE.md 每次修订时，本文件底部会自动追加变更记录。
`, { type: 'system-guide', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8');
        }
        // 分析要求 Tag 模板（拖入文件弹窗的可选项，AI 归纳维护）
        const tagsPath = path_1.default.join(this.wikiDir, 'ANALYSIS_TAGS.md');
        try {
            await fs_1.promises.access(tagsPath);
        }
        catch {
            await fs_1.promises.writeFile(tagsPath, gray_matter_1.default.stringify(`# 分析要求 Tag 模板\n\n> 系统维护：AI 归纳用户的分析要求形成可复用 tag，拖拽导入弹窗中可选。用户可自由编辑/删除。\n\n## Tags\n\n（暂无）`, { type: 'system-analysis-tags', 'graph-excluded': true, updated: new Date().toISOString() }), 'utf-8');
        }
    }
    /** 创建页面模板（LLM Wiki 模式标准结构） */
    async ensureTemplates() {
        const tplDir = path_1.default.join(this.wikiDir, 'templates');
        const templates = [
            ['source-template.md', [
                    '---',
                    'type: source',
                    'title: "来源标题"',
                    'date: YYYY-MM-DD',
                    'source_url: "https://"',
                    'domain: ""',
                    'author: ""',
                    'tags: []',
                    'processed: true',
                    'raw_file: "raw/articles/xxx.md"',
                    'raw_sha256: "<64-char-hex>"',
                    'last_verified: YYYY-MM-DD',
                    'possibly_outdated: false',
                    '---',
                    '# 标题',
                    '',
                    '## Summary',
                    '',
                    '## Key Points',
                    '',
                    '## Concepts Extracted',
                    '',
                    '## Entities Extracted',
                    '',
                    '## Contradictions',
                    '',
                    '## My Notes',
                    ''
                ].join('\n')],
            ['concept-template.md', [
                    '---',
                    'type: concept',
                    'title: "中文主名称"',
                    'date: YYYY-MM-DD',
                    'updated: YYYY-MM-DD',
                    'tags: []',
                    'source_count: 0',
                    'confidence: low',
                    'domain_volatility: medium',
                    'last_reviewed: YYYY-MM-DD',
                    'aliases: []',
                    '---',
                    '# 概念名（English Name）',
                    '',
                    '## Definition',
                    '',
                    '## Key Points',
                    '',
                    '## My Position',
                    '',
                    '## Contradictions',
                    '',
                    '## Sources',
                    '',
                    '## Evolution Log',
                    ''
                ].join('\n')],
            ['entity-template.md', [
                    '---',
                    'type: entity',
                    'title: "实体名"',
                    'date: YYYY-MM-DD',
                    'tags: []',
                    'entity_type: person',
                    'aliases: []',
                    '---',
                    '# 实体名',
                    '',
                    '## Description',
                    '',
                    '## Key Contributions',
                    '',
                    '## Related Concepts',
                    '',
                    '## Sources',
                    ''
                ].join('\n')],
            ['synthesis-template.md', [
                    '---',
                    'type: synthesis',
                    'title: "综合分析标题"',
                    'date: YYYY-MM-DD',
                    'tags: []',
                    'source_count: 0',
                    'confidence: low',
                    '---',
                    '# 综合分析',
                    '',
                    '## Thesis',
                    '',
                    '## Evidence',
                    '',
                    '## Counter-evidence',
                    '',
                    '## Synthesis',
                    '',
                    '## Confidence Notes',
                    '',
                    '## Limitations',
                    '',
                    '## Sources',
                    ''
                ].join('\n')],
            ['personal-writing-template.md', [
                    '---',
                    'type: personal-writing',
                    'title: "个人文章标题"',
                    'date: YYYY-MM-DD',
                    'status: draft',
                    'topic_tags: []',
                    'confidence_at_writing: medium',
                    'superseded_by: ""',
                    'raw_file: "raw/personal/xxx.md"',
                    'raw_sha256: "<64-char-hex>"',
                    'last_verified: YYYY-MM-DD',
                    'tags: []',
                    'processed: true',
                    '---',
                    '# 标题',
                    '',
                    '## Core Argument',
                    '',
                    '## Key Claims',
                    '',
                    '## Evidence Referenced',
                    '',
                    '## Limitations',
                    ''
                ].join('\n')]
        ];
        for (const [name, content] of templates) {
            const fullPath = path_1.default.join(tplDir, name);
            try {
                await fs_1.promises.access(fullPath);
            }
            catch {
                await fs_1.promises.writeFile(fullPath, content, 'utf-8');
            }
        }
    }
    async setVaultPath(newPath) {
        this.stopWatching();
        this.vaultPath = path_1.default.resolve(newPath);
        this.notesDir = this.vaultPath;
        this.attachmentsDir = path_1.default.join(this.vaultPath, 'attachments');
        await this.initialize();
    }
    onChange(cb) {
        this.changeCallbacks.push(cb);
        return () => {
            this.changeCallbacks = this.changeCallbacks.filter((c) => c !== cb);
        };
    }
    emit(event) {
        for (const cb of this.changeCallbacks) {
            try {
                cb(event);
            }
            catch { /* ignore */ }
        }
    }
    startWatching() {
        try {
            this.watcher = (0, fs_1.watch)(this.notesDir, { recursive: true }, (eventType, filename) => {
                if (!filename)
                    return;
                const ext = path_1.default.extname(filename).toLowerCase();
                if (!exports.INGESTIBLE_EXTS.includes(ext))
                    return;
                const relPath = filename.replace(/\\/g, '/');
                if (eventType === 'rename') {
                    fs_1.promises.access(path_1.default.join(this.notesDir, filename))
                        .then(() => this.emit({ type: 'created', path: relPath }))
                        .catch(() => this.emit({ type: 'deleted', path: relPath }));
                }
                else {
                    this.emit({ type: 'modified', path: relPath });
                }
            });
        }
        catch {
            // fs.watch may fail on some systems; silently ignore
        }
    }
    stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
    /** 递归列出目录中所有 .md 文件，构建树形结构（单个目录读取失败不影响整体） */
    async listNotes(dir) {
        const base = dir ? path_1.default.join(this.notesDir, dir) : this.notesDir;
        let entries = [];
        try {
            entries = (await fs_1.promises.readdir(base, { withFileTypes: true }));
        }
        catch {
            return []; // 目录不存在/读取失败 → 空列表，不中断
        }
        const result = [];
        // 文件夹在前，文件在后
        const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'attachments');
        const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
        for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
            let children = [];
            try {
                children = await this.listNotes(dir ? `${dir}/${d.name}` : d.name);
            }
            catch {
                children = [];
            }
            result.push({
                path: (dir ? `${dir}/${d.name}` : d.name).replace(/\\/g, '/'),
                title: d.name,
                tags: [],
                created: '',
                updated: '',
                kind: 'folder',
                children
            });
        }
        for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
            // 根级 CLAUDE.md 为行为契约（系统文件），不在文件树中展示，避免误删
            if (!dir && (f.name === 'CLAUDE.md' || f.name === 'USER_GUIDE.md'))
                continue;
            const relPath = (dir ? `${dir}/${f.name}` : f.name).replace(/\\/g, '/');
            try {
                const raw = await fs_1.promises.readFile(path_1.default.join(base, f.name), 'utf-8');
                const parsed = (0, gray_matter_1.default)(raw);
                const fm = parsed.data;
                result.push({
                    path: relPath,
                    title: fm.title || f.name.replace(/\.md$/, ''),
                    tags: Array.isArray(fm.tags) ? fm.tags : [],
                    created: fm.created || '',
                    updated: fm.updated || '',
                    kind: 'file'
                });
            }
            catch {
                result.push({
                    path: relPath,
                    title: f.name.replace(/\.md$/, ''),
                    tags: [],
                    created: '',
                    updated: '',
                    kind: 'file'
                });
            }
        }
        return result;
    }
    /** 列出 raw/ 目录下所有可摄入的文件（不限 .md），返回相对路径列表 */
    async listRawFiles() {
        const result = [];
        const scan = async (dir, rel) => {
            let entries;
            try {
                entries = (await fs_1.promises.readdir(dir, { withFileTypes: true }));
            }
            catch {
                return;
            }
            for (const e of entries) {
                if (e.isDirectory()) {
                    await scan(path_1.default.join(dir, e.name), `${rel}/${e.name}`);
                }
                else if (e.isFile()) {
                    const ext = path_1.default.extname(e.name).toLowerCase();
                    if (exports.INGESTIBLE_EXTS.includes(ext)) {
                        result.push(`${rel}/${e.name}`.replace(/^\//, '').replace(/\\/g, '/'));
                    }
                }
            }
        };
        await scan(this.rawDir, 'raw');
        return result;
    }
    /** 解析笔记中所有的 [[wiki links]] */
    parseWikiLinks(body) {
        const re = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;
        const links = [];
        let m;
        while ((m = re.exec(body)) !== null) {
            const target = m[1].trim();
            if (target && !links.includes(target)) {
                links.push(target);
            }
        }
        return links;
    }
    /** 读取笔记完整内容 */
    async readNote(relPath) {
        const fullPath = path_1.default.join(this.notesDir, relPath);
        const raw = await fs_1.promises.readFile(fullPath, 'utf-8');
        // 非文本文件（pdf/图片等）：不按 markdown 解析，正文留空避免乱码
        const ext = path_1.default.extname(relPath).toLowerCase();
        const textExts = ['.md', '.txt', '.markdown', '.json', '.js', '.ts', '.tsx', '.jsx', '.py',
            '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yml', '.yaml', '.csv', '.log', '.sh', '.bat'];
        if (!textExts.includes(ext)) {
            return {
                path: relPath.replace(/\\/g, '/'),
                title: path_1.default.basename(relPath),
                tags: [],
                created: '',
                updated: '',
                kind: 'file',
                rawBody: '',
                links: [],
                graphExcluded: false
            };
        }
        const parsed = (0, gray_matter_1.default)(raw);
        const fm = parsed.data;
        const links = this.parseWikiLinks(parsed.content);
        return {
            path: relPath.replace(/\\/g, '/'),
            title: fm.title || path_1.default.basename(relPath, '.md'),
            tags: Array.isArray(fm.tags) ? fm.tags : [],
            created: fm.created || new Date().toISOString(),
            updated: fm.updated || new Date().toISOString(),
            kind: 'file',
            rawBody: parsed.content,
            links,
            aiSummary: fm.aiSummary,
            aiAnalyzedAt: fm.aiAnalyzedAt,
            aiRelations: Array.isArray(fm.aiRelations) ? fm.aiRelations : undefined,
            annotations: Array.isArray(fm.annotations) ? fm.annotations : [],
            graphExcluded: fm['graph-excluded'] === true || fm['graph-excluded'] === 'true',
            rawFile: typeof fm.raw_file === 'string' && fm.raw_file ? fm.raw_file : undefined
        };
    }
    /** 写入（创建/更新）笔记 */
    async writeNote(relPath, data) {
        const fullPath = path_1.default.join(this.notesDir, relPath);
        await fs_1.promises.mkdir(path_1.default.dirname(fullPath), { recursive: true });
        // 读取旧文件：保留 created 时间与未传值的 AI/注释字段
        let oldFm = {};
        try {
            const oldRaw = await fs_1.promises.readFile(fullPath, 'utf-8');
            oldFm = (0, gray_matter_1.default)(oldRaw).data;
        }
        catch {
            // 新文件，使用默认值
        }
        const frontmatter = {
            title: data.title,
            tags: data.tags,
            created: oldFm.created || new Date().toISOString(),
            updated: new Date().toISOString()
        };
        // AI 分析字段：调用方传了新值则覆盖，未传则保留旧值（undefined 不写入 frontmatter）
        if (data.aiSummary !== undefined)
            frontmatter.aiSummary = data.aiSummary;
        else if (oldFm.aiSummary !== undefined)
            frontmatter.aiSummary = oldFm.aiSummary;
        if (data.aiAnalyzedAt !== undefined)
            frontmatter.aiAnalyzedAt = data.aiAnalyzedAt;
        else if (oldFm.aiAnalyzedAt !== undefined)
            frontmatter.aiAnalyzedAt = oldFm.aiAnalyzedAt;
        if (data.aiRelations !== undefined)
            frontmatter.aiRelations = data.aiRelations;
        else if (oldFm.aiRelations !== undefined)
            frontmatter.aiRelations = oldFm.aiRelations;
        if (oldFm.annotations !== undefined)
            frontmatter.annotations = oldFm.annotations;
        const content = gray_matter_1.default.stringify(data.body, frontmatter);
        await fs_1.promises.writeFile(fullPath, content, 'utf-8');
        // 契约修订同步：CLAUDE.md 保存后，在 USER_GUIDE.md 底部追加变更记录（文档维护规则）
        const normalized = relPath.replace(/\\/g, '/');
        if (normalized === 'CLAUDE.md') {
            await this.syncContractChangelog(data.title || '契约规则');
        }
    }
    /** 文档维护规则：CLAUDE.md 每次修订时同步 USER_GUIDE.md 变更记录 */
    async syncContractChangelog(summary) {
        const guidePath = path_1.default.join(this.vaultPath, 'USER_GUIDE.md');
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        try {
            const raw = await fs_1.promises.readFile(guidePath, 'utf-8');
            const parsed = (0, gray_matter_1.default)(raw);
            let body = parsed.content;
            const marker = '## 契约修订记录';
            const line = `- ${stamp}：CLAUDE.md 已修订（${summary}）`;
            if (body.includes(marker)) {
                body = `${body.trimEnd()}\n${line}\n`;
            }
            else {
                body = `${body.trimEnd()}\n\n${marker}\n\n${line}\n`;
            }
            const fm = { ...parsed.data, updated: new Date().toISOString() };
            await fs_1.promises.writeFile(guidePath, gray_matter_1.default.stringify(body, fm), 'utf-8');
        }
        catch {
            /* USER_GUIDE.md 不存在则跳过（ensureSystemFiles 会重建） */
        }
    }
    async deleteNote(relPath) {
        const fullPath = path_1.default.join(this.notesDir, relPath);
        await fs_1.promises.unlink(fullPath);
    }
    /** 创建新笔记（空模板），标题自动 sanitize 防止路径嵌套 */
    async createNote(relPath, title) {
        // 清理标题中的路径分隔/非法字符
        const safeTitle = String(title || '新笔记').replace(/[\\/:*?"<>|]/g, '-').trim() || '新笔记';
        // 文件名安全化：relPath 末尾文件名用 sanitize 后的标题
        const dir = path_1.default.dirname(relPath);
        const safeRelPath = dir === '.' ? `${safeTitle}.md` : `${dir}/${safeTitle}.md`;
        const frontmatter = {
            title: safeTitle,
            tags: [],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
        };
        const content = gray_matter_1.default.stringify('', frontmatter);
        const fullPath = path_1.default.join(this.notesDir, safeRelPath);
        await fs_1.promises.mkdir(path_1.default.dirname(fullPath), { recursive: true });
        await fs_1.promises.writeFile(fullPath, content, 'utf-8');
    }
    /** 解析 [[wiki link]] 为实际文件路径 */
    resolveLink(fromPath, linkTarget) {
        // 尝试多种匹配策略
        const candidates = [
            linkTarget + '.md',
            linkTarget.replace(/\s+/g, '-') + '.md',
            linkTarget
        ];
        const fromDir = path_1.default.dirname(fromPath);
        for (const c of candidates) {
            // 相对于当前笔记目录
            const rel = path_1.default.join(fromDir, c).replace(/\\/g, '/');
            const fullRel = path_1.default.join(this.notesDir, rel);
            try {
                // 同步检查文件是否存在（在 IPC handler 中运行）
                return rel;
            }
            catch {
                // continue
            }
        }
        // 在全局搜索
        for (const c of candidates) {
            const fullGlobal = path_1.default.join(this.notesDir, c);
            try {
                return c;
            }
            catch {
                // continue
            }
        }
        return null;
    }
    /** 查找引用某个笔记的所有笔记（反向链接） */
    async getBacklinks(targetPath) {
        const allNotes = await this.listNotes();
        const result = [];
        const targetId = targetPath.replace(/\.md$/, '').replace(/\\/g, '/');
        const flatNotes = this.flattenNotes(allNotes);
        for (const note of flatNotes) {
            if (note.kind !== 'file' || note.path === targetPath)
                continue;
            try {
                const content = await this.readNote(note.path);
                if (content.links.some((l) => {
                    const normalized = l.replace(/\\/g, '/');
                    return normalized === targetId || normalized === targetPath.replace(/\.md$/, '');
                })) {
                    result.push({ path: note.path, title: note.title });
                }
            }
            catch {
                // skip
            }
        }
        return result;
    }
    /** 获取所有标签及其计数 */
    async getAllTags() {
        const allNotes = await this.listNotes();
        const flatNotes = this.flattenNotes(allNotes);
        const tagMap = new Map();
        for (const note of flatNotes) {
            if (note.kind !== 'file')
                continue;
            for (const tag of note.tags) {
                tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
            }
        }
        return Array.from(tagMap.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }
    /** 按标签筛选笔记 */
    async getNotesByTag(tag) {
        const allNotes = await this.listNotes();
        const flatNotes = this.flattenNotes(allNotes);
        return flatNotes.filter((n) => n.kind === 'file' && n.tags.includes(tag));
    }
    /** 导入外部文件到 vault（LLM Wiki 模式：按类型路由到 raw/ 子目录） */
    async importFile(sourcePath, targetDir) {
        const name = path_1.default.basename(sourcePath);
        const ext = path_1.default.extname(sourcePath).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
        // 自动路由到 raw/<category>/（显式 targetDir 优先；兼容旧路径 targetDir 含 raw/ 前缀）
        let destDir;
        if (targetDir && targetDir.startsWith('raw/')) {
            destDir = path_1.default.join(this.vaultPath, targetDir);
        }
        else if (imageExts.includes(ext)) {
            destDir = targetDir ? path_1.default.join(this.rawDir, targetDir) : path_1.default.join(this.rawDir, 'images');
        }
        else if (ext === '.pdf') {
            destDir = path_1.default.join(this.rawDir, 'pdfs');
        }
        else if (['.md', '.txt', '.markdown'].includes(ext)) {
            destDir = path_1.default.join(this.rawDir, 'articles');
        }
        else {
            destDir = path_1.default.join(this.rawDir, 'notes');
        }
        await fs_1.promises.mkdir(destDir, { recursive: true });
        // 处理重名
        let destName = name;
        let destPath = path_1.default.join(destDir, destName);
        let counter = 1;
        while (await this.fileExists(destPath)) {
            const base = path_1.default.basename(name, ext);
            destName = `${base}-${counter}${ext}`;
            destPath = path_1.default.join(destDir, destName);
            counter++;
        }
        await fs_1.promises.copyFile(sourcePath, destPath);
        const relPath = path_1.default.relative(this.vaultPath, destPath).replace(/\\/g, '/');
        // 如果是 markdown 文件，确保 frontmatter 有基本字段
        if (ext === '.md') {
            try {
                const raw = await fs_1.promises.readFile(destPath, 'utf-8');
                const parsed = (0, gray_matter_1.default)(raw);
                if (!parsed.data.title && !parsed.data.created) {
                    const fixed = gray_matter_1.default.stringify(parsed.content, {
                        title: path_1.default.basename(name, '.md'),
                        tags: [],
                        created: new Date().toISOString(),
                        updated: new Date().toISOString()
                    });
                    await fs_1.promises.writeFile(destPath, fixed, 'utf-8');
                }
            }
            catch {
                // ignore
            }
        }
        return relPath;
    }
    /** 列出附件 */
    async listAttachments(subDir) {
        const dir = subDir ? path_1.default.join(this.attachmentsDir, subDir) : this.attachmentsDir;
        try {
            const entries = await fs_1.promises.readdir(dir, { withFileTypes: true });
            return entries
                .filter((e) => e.isFile())
                .map((e) => path_1.default.relative(this.vaultPath, path_1.default.join(dir, e.name)).replace(/\\/g, '/'));
        }
        catch {
            return [];
        }
    }
    /** 更新笔记的 AI 分析结果（tags 合并；摘要/关系/分析时间写入 frontmatter，刷新后保留） */
    async updateAiResults(relPath, aiSummary, aiTags, aiRelations) {
        const note = await this.readNote(relPath);
        const updatedTags = aiTags ? [...new Set([...note.tags, ...aiTags])] : note.tags;
        await this.writeNote(relPath, {
            title: note.title,
            tags: updatedTags,
            body: note.rawBody,
            aiSummary,
            aiRelations,
            aiAnalyzedAt: new Date().toISOString()
        });
    }
    /** 添加注释到笔记 */
    async addAnnotation(relPath, text, range) {
        const fullPath = path_1.default.join(this.notesDir, relPath);
        const raw = await fs_1.promises.readFile(fullPath, 'utf-8');
        const parsed = (0, gray_matter_1.default)(raw);
        const fm = parsed.data;
        const annotations = Array.isArray(fm.annotations) ? fm.annotations : [];
        const annotation = {
            id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            text,
            range,
            created: new Date().toISOString()
        };
        annotations.push(annotation);
        fm.annotations = annotations;
        const updated = gray_matter_1.default.stringify(parsed.content, fm);
        await fs_1.promises.writeFile(fullPath, updated, 'utf-8');
        return annotation;
    }
    /** 删除注释 */
    async removeAnnotation(relPath, annotationId) {
        const fullPath = path_1.default.join(this.notesDir, relPath);
        const raw = await fs_1.promises.readFile(fullPath, 'utf-8');
        const parsed = (0, gray_matter_1.default)(raw);
        const fm = parsed.data;
        const annotations = Array.isArray(fm.annotations) ? fm.annotations : [];
        fm.annotations = annotations.filter((a) => a.id !== annotationId);
        const updated = gray_matter_1.default.stringify(parsed.content, fm);
        await fs_1.promises.writeFile(fullPath, updated, 'utf-8');
    }
    dispose() {
        this.stopWatching();
        this.changeCallbacks = [];
    }
    async fileExists(p) {
        try {
            await fs_1.promises.access(p);
            return true;
        }
        catch {
            return false;
        }
    }
    flattenNotes(notes) {
        const result = [];
        for (const n of notes) {
            result.push(n);
            if (n.children) {
                result.push(...this.flattenNotes(n.children));
            }
        }
        return result;
    }
}
exports.VaultManager = VaultManager;
