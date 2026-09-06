"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDataDir = seedDataDir;
exports.createWinAgentCore = createWinAgentCore;
/**
 * WinAgent 服务核心装配：EventBus → ConfigStore → ToolRegistry → AgentService → WikiHost。
 * DSH 插件宿主（server.ts）与 Electron 桌面版主进程共用同一装配逻辑，避免两处漂移。
 * @module dsh-winagent/bootstrap
 */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const event_bus_1 = require("./event-bus");
const ConfigStore_1 = require("./config/ConfigStore");
const ToolRegistry_1 = require("./tools/ToolRegistry");
const AgentService_1 = require("./agent/AgentService");
const wiki_host_1 = require("./wiki/wiki-host");
const KnowledgeRetriever_1 = require("./wiki/KnowledgeRetriever");
const wikiTools_1 = require("./tools/wikiTools");
const Logger_1 = require("./util/Logger");
const capabilities_1 = require("./util/capabilities");
const platform_1 = require("./platform");
async function copyDir(src, dst) {
    const entries = await fs_1.promises.readdir(src, { withFileTypes: true }).catch(() => []);
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
/** 首次使用播种数据目录：skills（pdf/docx/pptx/xlsx 读取器 + 视觉渲染/抽图）与 mcp.json 默认模板 */
async function seedDataDir() {
    const dir = (0, ConfigStore_1.getDataDir)();
    await fs_1.promises.mkdir(dir, { recursive: true });
    const skillsDir = path_1.default.join(dir, 'skills');
    const bundled = path_1.default.join(platform_1.PACKAGE_ROOT, 'assets', 'skills');
    // 按文件夹增量合并：老数据目录也能拿到后续版本新增的 skills（已存在的文件夹不动，尊重用户修改）
    const bundledSkills = await fs_1.promises.readdir(bundled).catch(() => []);
    for (const name of bundledSkills) {
        const src = path_1.default.join(bundled, name);
        const dst = path_1.default.join(skillsDir, name);
        try {
            const st = await fs_1.promises.stat(src);
            if (!st.isDirectory())
                continue;
            await fs_1.promises.access(path_1.default.join(dst, 'SKILL.md')).then(() => { }, async () => {
                await fs_1.promises.mkdir(path_1.default.dirname(dst), { recursive: true });
                await copyDir(src, dst);
            });
        }
        catch { /* ignore 单个 skill 播种失败 */ }
    }
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
/**
 * 装配完整服务核心。
 * 注意：必须在进程入口先设置 WINAGENT_DATA_DIR（桌面版），再调用本函数。
 */
async function createWinAgentCore() {
    const bus = new event_bus_1.EventBus();
    const store = new ConfigStore_1.ConfigStore();
    const registry = new ToolRegistry_1.ToolRegistry();
    const agent = new AgentService_1.AgentService(store, registry);
    const reloadTools = async () => {
        const cfg = store.get();
        await registry.initialize(cfg);
        const p = cfg.skillsDir || 'skills';
        const skillsDir = path_1.default.isAbsolute(p) ? p : path_1.default.join((0, ConfigStore_1.getDataDir)(), p);
        const mp = cfg.mcpConfigPath || 'mcp.json';
        const mcpPath = path_1.default.isAbsolute(mp) ? mp : path_1.default.join((0, ConfigStore_1.getDataDir)(), mp);
        await registry.loadExternal(skillsDir, mcpPath);
    };
    await seedDataDir();
    // 预热能力探测缓存（pandoc/soffice/Office COM/pdfjs/PyMuPDF）：避免首轮对话卡在同步探测
    (0, capabilities_1.getCapabilities)();
    const cfg = await store.load();
    const wikiHost = new wiki_host_1.WikiHost(store, bus);
    await wikiHost.init();
    registry.setWikiTools((0, wikiTools_1.createWikiTools)(wikiHost.vault, wikiHost.search, store));
    await registry.initialize(cfg);
    await reloadTools();
    // 自动 RAG：每轮提问自动检索知识库并注入结果
    agent.setKnowledgeRetriever(new KnowledgeRetriever_1.KnowledgeRetriever(wikiHost.vault, wikiHost.search, store));
    Logger_1.Logger.info('WinAgent 服务核心装配完成，数据目录: ' + (0, ConfigStore_1.getDataDir)());
    return {
        bus, store, registry, agent, wikiHost,
        reloadTools,
        dispose() {
            wikiHost.dispose();
            registry.dispose();
        }
    };
}
