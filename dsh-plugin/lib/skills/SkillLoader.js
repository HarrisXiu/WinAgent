"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSkills = loadSkills;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const gray_matter_1 = __importDefault(require("gray-matter"));
const Logger_1 = require("../util/Logger");
const platform_1 = require("../platform");
function runtimeCmd(runtime, entry) {
    switch (runtime) {
        case 'python':
            return { cmd: 'python', args: [entry] };
        case 'command':
            return { cmd: 'cmd.exe', args: ['/c', entry] };
        case 'node':
        default:
            return { cmd: process.execPath, args: [entry] };
    }
}
function execSkill(dir, manifest, args) {
    return new Promise((resolve, reject) => {
        const entry = path_1.default.join(dir, manifest.entry);
        const { cmd, args: baseArgs } = runtimeCmd(manifest.runtime || 'node', entry);
        // node 运行时禁用 Electron 特有行为；NODE_PATH 让 skill 脚本能 require 插件依赖
        const env = (0, platform_1.skillEnv)();
        const proc = (0, child_process_1.spawn)(cmd, baseArgs, { cwd: dir, env, windowsHide: true });
        let out = '';
        let err = '';
        proc.stdout.on('data', (d) => (out += d.toString()));
        proc.stderr.on('data', (d) => (err += d.toString()));
        proc.on('close', (code) => {
            if (code === 0)
                resolve(out.trim() || '(skill 无输出)');
            else
                reject(new Error(err.trim() || `skill 退出码 ${code}`));
        });
        proc.on('error', (e) => reject(e));
        // 参数以 JSON 从 stdin 传入
        proc.stdin.write(JSON.stringify(args));
        proc.stdin.end();
    });
}
async function loadSkills(skillsDir) {
    const tools = [];
    let entries;
    try {
        entries = await fs_1.promises.readdir(skillsDir);
    }
    catch {
        return tools;
    }
    for (const name of entries) {
        const dir = path_1.default.join(skillsDir, name);
        try {
            const st = await fs_1.promises.stat(dir);
            if (!st.isDirectory())
                continue;
            // 格式 1：manifest.json（WinAgent 原生格式）
            const manifestPath = path_1.default.join(dir, 'manifest.json');
            const skillMdPath = path_1.default.join(dir, 'SKILL.md');
            let manifest = null;
            let skillMdText = null;
            try {
                manifest = JSON.parse(await fs_1.promises.readFile(manifestPath, 'utf-8'));
            }
            catch {
                manifest = null;
            }
            try {
                skillMdText = await fs_1.promises.readFile(skillMdPath, 'utf-8');
            }
            catch {
                skillMdText = null;
            }
            // 格式 2：SKILL.md（Anthropic 官方格式，frontmatter 提供元数据）
            let mdMeta = {};
            let mdBody = '';
            if (!manifest && skillMdText) {
                const parsed = (0, gray_matter_1.default)(skillMdText);
                mdMeta = (parsed.data || {});
                mdBody = parsed.content.trim();
            }
            if (manifest) {
                if (!manifest.name || !manifest.entry)
                    continue;
                tools.push({
                    schema: {
                        name: manifest.name,
                        description: `[skill] ${manifest.description || manifest.name}`,
                        parameters: manifest.parameters || { type: 'object', properties: {}, required: [] }
                    },
                    dangerous: manifest.dangerous,
                    run: (args) => execSkill(dir, manifest, args)
                });
                Logger_1.Logger.info(`[Skill] 已加载 (manifest.json): ${manifest.name}`);
                continue;
            }
            if (skillMdText && mdMeta.name) {
                const name = String(mdMeta.name);
                const description = String(mdMeta.description || name);
                // 可执行字段：entry/command（兼容官方 executable-manifest 提案与自定义扩展）
                const entry = mdMeta.entry ? String(mdMeta.entry) : null;
                const runtime = mdMeta.runtime || 'node';
                const parameters = mdMeta.parameters || {
                    type: 'object',
                    properties: {},
                    required: []
                };
                const dangerous = !!mdMeta.dangerous;
                const mdContent = skillMdText;
                tools.push({
                    schema: {
                        name,
                        description: `[skill] ${description}（SKILL.md 指令：${mdBody.slice(0, 200)}…）`,
                        parameters
                    },
                    dangerous,
                    run: async (args) => {
                        if (entry) {
                            // 有入口脚本 → 作为可执行工具运行（stdin JSON → stdout 结果）
                            return execSkill(dir, { name, description, entry, runtime, parameters, dangerous }, args);
                        }
                        // 无入口脚本 → 返回 SKILL.md 完整指令，由 LLM 遵循执行
                        return `以下是技能「${name}」的操作指令（SKILL.md 全文），请严格遵循执行：\n\n${mdContent}`;
                    }
                });
                Logger_1.Logger.info(`[Skill] 已加载 (SKILL.md): ${name}`);
                continue;
            }
            Logger_1.Logger.info(`[Skill] 跳过 ${name}: 缺少 manifest.json 或 SKILL.md`);
        }
        catch (e) {
            Logger_1.Logger.error(`[Skill] 加载失败 ${name}: ${String(e)}`);
        }
    }
    return tools;
}
