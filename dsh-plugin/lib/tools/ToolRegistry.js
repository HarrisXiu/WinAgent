"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
const fileTools_1 = require("./fileTools");
const systemTools_1 = require("./systemTools");
const registryTools_1 = require("./registryTools");
const inputTools_1 = require("./inputTools");
const windowTools_1 = require("./windowTools");
const httpTools_1 = require("./httpTools");
const officeTools_1 = require("./officeTools");
const SkillLoader_1 = require("../skills/SkillLoader");
const McpManager_1 = require("../mcp/McpManager");
const Logger_1 = require("../util/Logger");
class ToolRegistry {
    tools = new Map();
    wikiTools = [];
    mcp = new McpManager_1.McpManager();
    addAll(tools, source) {
        for (const t of tools)
            this.tools.set(t.schema.name, { tool: t, source });
    }
    /** 注册知识库工具（在 initialize 前调用，工具将在下次 initialize 时生效） */
    setWikiTools(tools) {
        this.wikiTools = tools;
    }
    async initialize(cfg) {
        this.tools.clear();
        this.mcp.dispose();
        // 内置工具（含知识库工具）
        this.addAll([...fileTools_1.fileTools, ...systemTools_1.systemTools, ...registryTools_1.registryTools, ...inputTools_1.inputTools, ...windowTools_1.windowTools, ...httpTools_1.httpTools, ...officeTools_1.officeTools, ...this.wikiTools], 'builtin');
        void cfg;
        Logger_1.Logger.info(`[Tools] 内置工具 ${this.tools.size} 个`);
    }
    /** 分别加载 skills 与 mcp（传入已解析的绝对路径） */
    async loadExternal(skillsDirAbs, mcpConfigAbs) {
        try {
            const skills = await (0, SkillLoader_1.loadSkills)(skillsDirAbs);
            this.addAll(skills, 'skill');
            Logger_1.Logger.info(`[Tools] Skills ${skills.length} 个`);
        }
        catch (e) {
            Logger_1.Logger.error(`[Tools] Skills 加载失败: ${String(e)}`);
        }
        try {
            const mcpTools = await this.mcp.load(mcpConfigAbs);
            this.addAll(mcpTools, 'mcp');
            Logger_1.Logger.info(`[Tools] MCP ${mcpTools.length} 个`);
        }
        catch (e) {
            Logger_1.Logger.error(`[Tools] MCP 加载失败: ${String(e)}`);
        }
    }
    getSchemas() {
        return [...this.tools.values()].map((e) => e.tool.schema);
    }
    getInfos() {
        return [...this.tools.values()].map((e) => ({
            name: e.tool.schema.name,
            description: e.tool.schema.description,
            source: e.source,
            dangerous: !!e.tool.dangerous
        }));
    }
    getSource(name) {
        return this.tools.get(name)?.source || 'builtin';
    }
    isDangerous(name) {
        return !!this.tools.get(name)?.tool.dangerous;
    }
    async execute(name, args) {
        const entry = this.tools.get(name);
        if (!entry)
            return { ok: false, result: `未知工具: ${name}` };
        try {
            const result = await entry.tool.run(args || {});
            return { ok: true, result };
        }
        catch (e) {
            return { ok: false, result: `错误: ${e instanceof Error ? e.message : String(e)}` };
        }
    }
    dispose() {
        this.mcp.dispose();
    }
}
exports.ToolRegistry = ToolRegistry;
