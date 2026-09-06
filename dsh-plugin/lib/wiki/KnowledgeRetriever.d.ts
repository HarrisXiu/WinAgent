import type { ConfigStore } from '../config/ConfigStore';
import type { SearchIndex } from './SearchIndex';
import type { VaultManager } from './VaultManager';
/** RAG 注入结果：text 为组装好的注入块（count=0 时是"未找到"提示），count 为命中条数 */
export interface KnowledgeInjection {
    text: string;
    count: number;
}
/** 注入块首行标记（ContextManager 压缩时按此识别并剥离旧注入） */
export declare const KNOWLEDGE_MARK = "\u3010\u77E5\u8BC6\u5E93\u68C0\u7D22";
/**
 * 自动 RAG 检索器：每轮用户提问后检索个人知识库，把相关笔记摘要组装成紧凑块注入上下文。
 * 纯内存检索、无 LLM 调用；任何失败由调用方静默跳过（不阻断对话）。
 */
export declare class KnowledgeRetriever {
    private vault;
    private search;
    private store;
    constructor(vault: VaultManager, search: SearchIndex, store: ConfigStore);
    /** 依据用户输入检索并组装注入文本；返回 null 表示本轮不注入 */
    retrieve(userInput: string): Promise<KnowledgeInjection | null>;
}
