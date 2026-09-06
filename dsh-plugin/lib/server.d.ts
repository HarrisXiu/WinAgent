import type { ConfigStore } from './config/ConfigStore';
import type { ToolRegistry } from './tools/ToolRegistry';
import type { AgentService } from './agent/AgentService';
import { EventBus } from './event-bus';
export interface ServerHost {
    init(): Promise<void>;
    registerRoutes(webServer: any): void;
    dispose(): void;
}
export declare function createServerHost(ctx: any, store: ConfigStore, registry: ToolRegistry, agent: AgentService, bus: EventBus): ServerHost;
