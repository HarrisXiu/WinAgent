"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.apply = apply;
/**
 * dsh-winagent 插件入口：cordis 插件对象。
 * 挂载后通过 /winagent/* 提供 WinAgent（Windows 操作 Agent）的 Web UI 与 API。
 * @module dsh-winagent
 */
const ConfigStore_1 = require("./config/ConfigStore");
const ToolRegistry_1 = require("./tools/ToolRegistry");
const AgentService_1 = require("./agent/AgentService");
const event_bus_1 = require("./event-bus");
const server_1 = require("./server");
exports.name = 'dsh-winagent';
exports.inject = ['webServer'];
function apply(ctx) {
    if (!ctx.webServer)
        return;
    const bus = new event_bus_1.EventBus();
    const store = new ConfigStore_1.ConfigStore();
    const registry = new ToolRegistry_1.ToolRegistry();
    const agent = new AgentService_1.AgentService(store, registry);
    const host = (0, server_1.createServerHost)(ctx, store, registry, agent, bus);
    host.registerRoutes(ctx.webServer);
    void host.init().catch((err) => {
        ctx.logger?.warn?.('dsh-winagent init failed: ' + String(err?.message || err));
    });
    ctx.effect(() => () => host.dispose());
}
