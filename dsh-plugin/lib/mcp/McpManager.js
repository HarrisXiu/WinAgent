"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpManager = void 0;
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const Logger_1 = require("../util/Logger");
const PROTOCOL_VERSION = '2024-11-05';
class StdioTransport {
    proc;
    buffer = '';
    nextId = 1;
    pending = new Map();
    constructor(cfg) {
        this.proc = (0, child_process_1.spawn)(cfg.command, cfg.args || [], {
            env: { ...process.env, ...(cfg.env || {}) },
            windowsHide: true
        });
        this.proc.stdout.on('data', (d) => this.onData(d.toString()));
        this.proc.stderr.on('data', (d) => Logger_1.Logger.info(`[MCP:stderr] ${d.toString().trim()}`));
        this.proc.on('error', (e) => Logger_1.Logger.error(`[MCP] 进程错误: ${String(e)}`));
    }
    onData(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            const t = line.trim();
            if (!t)
                continue;
            let msg;
            try {
                msg = JSON.parse(t);
            }
            catch {
                continue;
            }
            if (msg.id !== undefined && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error)
                    p.reject(new Error(msg.error.message || 'MCP error'));
                else
                    p.resolve(msg.result);
            }
        }
    }
    request(method, params) {
        const id = this.nextId++;
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n';
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.proc.stdin.write(payload);
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`MCP 请求超时: ${method}`));
                }
            }, 30000);
        });
    }
    notify(method, params) {
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
    }
    close() {
        try {
            this.proc.kill();
        }
        catch {
            /* ignore */
        }
    }
}
class HttpTransport {
    cfg;
    nextId = 1;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async request(method, params) {
        const res = await fetch(this.cfg.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.cfg.headers || {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params: params || {} })
        });
        const json = await res.json();
        if (json.error)
            throw new Error(json.error.message || 'MCP error');
        return json.result;
    }
    notify(method, params) {
        void fetch(this.cfg.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}) },
            body: JSON.stringify({ jsonrpc: '2.0', method, params: params || {} })
        }).catch(() => { });
    }
    close() {
        /* stateless */
    }
}
class McpManager {
    transports = [];
    async load(mcpConfigPath) {
        let file;
        try {
            file = JSON.parse(await fs_1.promises.readFile(mcpConfigPath, 'utf-8'));
        }
        catch {
            return [];
        }
        const servers = file.mcpServers || {};
        const tools = [];
        for (const [name, cfg] of Object.entries(servers)) {
            if (cfg.disabled)
                continue;
            try {
                const transport = 'url' in cfg ? new HttpTransport(cfg) : new StdioTransport(cfg);
                await transport.request('initialize', {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: { name: 'WinAgent', version: '1.0.0' }
                });
                transport.notify('notifications/initialized');
                const list = await transport.request('tools/list');
                const mcpTools = list?.tools || [];
                for (const t of mcpTools) {
                    const toolName = `mcp__${name}__${t.name}`;
                    tools.push({
                        schema: {
                            name: toolName,
                            description: `[MCP:${name}] ${t.description || t.name}`,
                            parameters: t.inputSchema || { type: 'object', properties: {}, required: [] }
                        },
                        dangerous: true,
                        run: async (args) => {
                            const result = await transport.request('tools/call', { name: t.name, arguments: args });
                            const content = result?.content;
                            if (Array.isArray(content)) {
                                return content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
                            }
                            return JSON.stringify(result);
                        }
                    });
                }
                this.transports.push(transport);
                Logger_1.Logger.info(`[MCP] 服务器 '${name}' 已连接，注册 ${mcpTools.length} 个工具`);
            }
            catch (e) {
                Logger_1.Logger.error(`[MCP] 服务器 '${name}' 启动失败: ${String(e)}`);
            }
        }
        return tools;
    }
    dispose() {
        this.transports.forEach((t) => t.close());
        this.transports = [];
    }
}
exports.McpManager = McpManager;
