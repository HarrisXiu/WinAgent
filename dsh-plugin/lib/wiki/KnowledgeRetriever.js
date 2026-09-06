"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeRetriever = exports.KNOWLEDGE_MARK = void 0;
/** 注入块首行标记（ContextManager 压缩时按此识别并剥离旧注入） */
exports.KNOWLEDGE_MARK = '【知识库检索';
/**
 * 自动 RAG 检索器：每轮用户提问后检索个人知识库，把相关笔记摘要组装成紧凑块注入上下文。
 * 纯内存检索、无 LLM 调用；任何失败由调用方静默跳过（不阻断对话）。
 */
class KnowledgeRetriever {
    vault;
    search;
    store;
    constructor(vault, search, store) {
        this.vault = vault;
        this.search = search;
        this.store = store;
    }
    /** 依据用户输入检索并组装注入文本；返回 null 表示本轮不注入 */
    async retrieve(userInput) {
        const cfg = this.store.get();
        const rag = cfg.knowledgeRag;
        if (!rag?.enabled)
            return null;
        const query = (userInput || '').trim();
        if (query.length < 2)
            return null;
        // 截断超长输入，防止粘贴长文撑爆检索与注入
        const topK = Math.min(Math.max(rag.topK || 3, 1), 8);
        const minScore = typeof rag.minScore === 'number' ? rag.minScore : 0.12;
        const results = this.search.search(query.slice(0, 200), topK);
        const hits = results.filter((r) => r.score >= minScore);
        if (hits.length === 0) {
            return {
                count: 0,
                text: [
                    exports.KNOWLEDGE_MARK + '提示】系统已在个人知识库中检索，未找到与本问题相关的内容。',
                    '（若这是知识类问题，请明确告知用户知识库中没有相关资料，再用自己的知识回答并标注「未经知识库验证」；系统操作类请求请忽略本提示直接执行）'
                ].join('\n')
            };
        }
        const lines = [
            `${exports.KNOWLEDGE_MARK}结果】（系统自动检索个人知识库所得，供回答参考，非用户输入；优先依据以下内容回答并注明来源笔记）`,
            ''
        ];
        for (let i = 0; i < hits.length; i++) {
            const r = hits[i];
            const meta = r.confidence ? `  confidence: ${r.confidence}` : '';
            const snippet = (r.summary || r.snippet || '').slice(0, 200);
            lines.push(`${i + 1}. 《${r.title}》 ${r.path}${meta}`);
            if (snippet)
                lines.push(`   ${snippet}`);
        }
        lines.push(`（共 ${hits.length} 条；需要完整内容时用 retrieve_knowledge 或 read_note）`);
        return { count: hits.length, text: lines.join('\n') };
    }
}
exports.KnowledgeRetriever = KnowledgeRetriever;
