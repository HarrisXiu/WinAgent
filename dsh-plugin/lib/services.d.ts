/**
 * dsh-winagent 服务层导出：供 Electron 桌面版主进程（或其他宿主）直接导入复用。
 * 与插件入口 index.ts 的区别：这里不依赖 DSH webServer，纯服务对象装配。
 * @module dsh-winagent/services
 */
export { EventBus, type BusEvent } from './event-bus';
export { ConfigStore, defaultConfig, getDataDir, DEFAULT_PERSONA_PROMPT, DEFAULT_PET_PROMPT, LEGACY_SYSTEM_PROMPT } from './config/ConfigStore';
export { ToolRegistry } from './tools/ToolRegistry';
export { AgentService, type KnowledgeRetrieverLike, type AgentCallbacks } from './agent/AgentService';
export { ContextManager, estimateTokens } from './agent/ContextManager';
export { WikiHost } from './wiki/wiki-host';
export { KnowledgeRetriever, KNOWLEDGE_MARK } from './wiki/KnowledgeRetriever';
export { SearchIndex } from './wiki/SearchIndex';
export { VaultManager } from './wiki/VaultManager';
export { GraphEngine } from './wiki/GraphEngine';
export { AiPipeline } from './wiki/AiPipeline';
export { runLint, runMerge, runReflect, runQuery } from './wiki/WorkflowService';
export { createWikiTools } from './tools/wikiTools';
export { fetchModels, chatStream } from './llm/OpenAIClient';
export { createWinAgentCore, seedDataDir, type WinAgentCore } from './bootstrap';
export { Logger } from './util/Logger';
export type * from './shared/types';
