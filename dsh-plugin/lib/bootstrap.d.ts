import { EventBus } from './event-bus';
import { ConfigStore } from './config/ConfigStore';
import { ToolRegistry } from './tools/ToolRegistry';
import { AgentService } from './agent/AgentService';
import { WikiHost } from './wiki/wiki-host';
/** WinAgent 服务核心：一次装配，宿主按需使用 */
export interface WinAgentCore {
    bus: EventBus;
    store: ConfigStore;
    registry: ToolRegistry;
    agent: AgentService;
    wikiHost: WikiHost;
    /** 重新加载内置工具 + skills + MCP（配置保存后调用） */
    reloadTools(): Promise<void>;
    dispose(): void;
}
/** 首次使用播种数据目录：skills（pdf/docx/pptx/xlsx 读取器 + 视觉渲染/抽图）与 mcp.json 默认模板 */
export declare function seedDataDir(): Promise<void>;
/**
 * 装配完整服务核心。
 * 注意：必须在进程入口先设置 WINAGENT_DATA_DIR（桌面版），再调用本函数。
 */
export declare function createWinAgentCore(): Promise<WinAgentCore>;
