import type { AgentEvent, ChatMessage, TokenUsage } from '../shared/types';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type { ConfigStore } from '../config/ConfigStore';
export interface AgentCallbacks {
    onEvent: (e: AgentEvent) => void;
    confirmTool: (name: string, args: string) => Promise<boolean>;
}
/** 知识检索能力接口（由 wiki 侧 KnowledgeRetriever 实现，server.ts 装配时注入；结构化类型避免模块循环依赖） */
export interface KnowledgeRetrieverLike {
    retrieve(userInput: string): Promise<{
        text: string;
        count: number;
    } | null>;
}
export declare class AgentService {
    private store;
    private registry;
    private history;
    private abort;
    /** 本会话累计 token 用量 */
    private sessionUsage;
    /** 知识检索能力（WikiHost 初始化后由装配方注入；未注入时跳过自动 RAG） */
    private knowledge;
    constructor(store: ConfigStore, registry: ToolRegistry);
    /** 注入知识检索能力（AgentService 创建早于 WikiHost，只能 setter 注入） */
    setKnowledgeRetriever(r: KnowledgeRetrieverLike): void;
    reset(): void;
    getUsage(): TokenUsage;
    /** 累加单次用量并上报；任一次为估算则会话总量标记为估算 */
    private reportUsage;
    stop(): void;
    getHistory(): ChatMessage[];
    private systemMessage;
    /** 从工具结果文本剥离 [[IMG:...]] 标记：返回净化文本与 dataUrl 列表 */
    private extractToolImages;
    /**
     * 把历史中所有带图片的 user 消息降级为纯文本（视觉辅助描述或提示）。
     * 用于主模型声称支持 vision 但网关实际拒收图片后的重试。
     */
    private stripHistoryImages;
    /**
     * 把历史中所有 user 消息里的 file parts（PDF 直传）剥离为工具读取提示（保留图片与文本）。
     * 用于网关拒收文件输入后的降级重试。
     */
    private stripHistoryFileParts;
    /**
     * 调用外部视觉模型识别图片，返回描述文本。
     * 每张图片单独一次请求，避免多图混淆且便于定位失败。
     */
    private describeImages;
    /**
     * 构建用户消息内容。
     * forceNoVision=true 时强制走非 vision 路径（用于主模型实际拒收图片后的降级重试）。
     * 返回 multipart=true 表示消息里带了图片（可触发图片降级）；
     * hasFiles=true 表示带了 PDF 文件直传（网关拒收时可降级为工具读取提示）。
     */
    private buildUserContent;
    process(userInput: string, cb: AgentCallbacks, attachments?: any[]): Promise<void>;
    compactNow(cb: AgentCallbacks): Promise<void>;
}
