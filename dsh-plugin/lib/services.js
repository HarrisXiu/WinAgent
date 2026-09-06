"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.seedDataDir = exports.createWinAgentCore = exports.chatStream = exports.fetchModels = exports.createWikiTools = exports.runQuery = exports.runReflect = exports.runMerge = exports.runLint = exports.AiPipeline = exports.GraphEngine = exports.VaultManager = exports.SearchIndex = exports.KNOWLEDGE_MARK = exports.KnowledgeRetriever = exports.WikiHost = exports.estimateTokens = exports.ContextManager = exports.AgentService = exports.ToolRegistry = exports.LEGACY_SYSTEM_PROMPT = exports.DEFAULT_PET_PROMPT = exports.DEFAULT_PERSONA_PROMPT = exports.getDataDir = exports.defaultConfig = exports.ConfigStore = exports.EventBus = void 0;
/**
 * dsh-winagent 服务层导出：供 Electron 桌面版主进程（或其他宿主）直接导入复用。
 * 与插件入口 index.ts 的区别：这里不依赖 DSH webServer，纯服务对象装配。
 * @module dsh-winagent/services
 */
var event_bus_1 = require("./event-bus");
Object.defineProperty(exports, "EventBus", { enumerable: true, get: function () { return event_bus_1.EventBus; } });
var ConfigStore_1 = require("./config/ConfigStore");
Object.defineProperty(exports, "ConfigStore", { enumerable: true, get: function () { return ConfigStore_1.ConfigStore; } });
Object.defineProperty(exports, "defaultConfig", { enumerable: true, get: function () { return ConfigStore_1.defaultConfig; } });
Object.defineProperty(exports, "getDataDir", { enumerable: true, get: function () { return ConfigStore_1.getDataDir; } });
Object.defineProperty(exports, "DEFAULT_PERSONA_PROMPT", { enumerable: true, get: function () { return ConfigStore_1.DEFAULT_PERSONA_PROMPT; } });
Object.defineProperty(exports, "DEFAULT_PET_PROMPT", { enumerable: true, get: function () { return ConfigStore_1.DEFAULT_PET_PROMPT; } });
Object.defineProperty(exports, "LEGACY_SYSTEM_PROMPT", { enumerable: true, get: function () { return ConfigStore_1.LEGACY_SYSTEM_PROMPT; } });
var ToolRegistry_1 = require("./tools/ToolRegistry");
Object.defineProperty(exports, "ToolRegistry", { enumerable: true, get: function () { return ToolRegistry_1.ToolRegistry; } });
var AgentService_1 = require("./agent/AgentService");
Object.defineProperty(exports, "AgentService", { enumerable: true, get: function () { return AgentService_1.AgentService; } });
var ContextManager_1 = require("./agent/ContextManager");
Object.defineProperty(exports, "ContextManager", { enumerable: true, get: function () { return ContextManager_1.ContextManager; } });
Object.defineProperty(exports, "estimateTokens", { enumerable: true, get: function () { return ContextManager_1.estimateTokens; } });
var wiki_host_1 = require("./wiki/wiki-host");
Object.defineProperty(exports, "WikiHost", { enumerable: true, get: function () { return wiki_host_1.WikiHost; } });
var KnowledgeRetriever_1 = require("./wiki/KnowledgeRetriever");
Object.defineProperty(exports, "KnowledgeRetriever", { enumerable: true, get: function () { return KnowledgeRetriever_1.KnowledgeRetriever; } });
Object.defineProperty(exports, "KNOWLEDGE_MARK", { enumerable: true, get: function () { return KnowledgeRetriever_1.KNOWLEDGE_MARK; } });
var SearchIndex_1 = require("./wiki/SearchIndex");
Object.defineProperty(exports, "SearchIndex", { enumerable: true, get: function () { return SearchIndex_1.SearchIndex; } });
var VaultManager_1 = require("./wiki/VaultManager");
Object.defineProperty(exports, "VaultManager", { enumerable: true, get: function () { return VaultManager_1.VaultManager; } });
var GraphEngine_1 = require("./wiki/GraphEngine");
Object.defineProperty(exports, "GraphEngine", { enumerable: true, get: function () { return GraphEngine_1.GraphEngine; } });
var AiPipeline_1 = require("./wiki/AiPipeline");
Object.defineProperty(exports, "AiPipeline", { enumerable: true, get: function () { return AiPipeline_1.AiPipeline; } });
var WorkflowService_1 = require("./wiki/WorkflowService");
Object.defineProperty(exports, "runLint", { enumerable: true, get: function () { return WorkflowService_1.runLint; } });
Object.defineProperty(exports, "runMerge", { enumerable: true, get: function () { return WorkflowService_1.runMerge; } });
Object.defineProperty(exports, "runReflect", { enumerable: true, get: function () { return WorkflowService_1.runReflect; } });
Object.defineProperty(exports, "runQuery", { enumerable: true, get: function () { return WorkflowService_1.runQuery; } });
var wikiTools_1 = require("./tools/wikiTools");
Object.defineProperty(exports, "createWikiTools", { enumerable: true, get: function () { return wikiTools_1.createWikiTools; } });
var OpenAIClient_1 = require("./llm/OpenAIClient");
Object.defineProperty(exports, "fetchModels", { enumerable: true, get: function () { return OpenAIClient_1.fetchModels; } });
Object.defineProperty(exports, "chatStream", { enumerable: true, get: function () { return OpenAIClient_1.chatStream; } });
var bootstrap_1 = require("./bootstrap");
Object.defineProperty(exports, "createWinAgentCore", { enumerable: true, get: function () { return bootstrap_1.createWinAgentCore; } });
Object.defineProperty(exports, "seedDataDir", { enumerable: true, get: function () { return bootstrap_1.seedDataDir; } });
var Logger_1 = require("./util/Logger");
Object.defineProperty(exports, "Logger", { enumerable: true, get: function () { return Logger_1.Logger; } });
