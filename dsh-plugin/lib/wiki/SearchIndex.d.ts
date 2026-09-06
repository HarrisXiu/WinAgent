import type { NoteMeta, SearchResult } from '../shared/types';
/**
 * 内存倒排索引（BM25 简化版）：
 * - 中英混合分词，中文滑窗 bigram + 低权重 unigram（单字查询不再全空）
 * - 字段加权（title/aliases/tags/summary/content）
 * - IDF 加权评分并归一化到 0~1（跨查询可比，供 RAG 阈值过滤）
 */
export declare class SearchIndex {
    private docs;
    private postings;
    private pathTokens;
    /** 中英文混合分词：英文/数字词（≥2 字符）+ 中文 bigram/unigram */
    private tokenize;
    /**
     * 分字段分词：对每个字段按其权重生成 token → 权重映射（同 token 取最高权重）。
     * 中文串同时产出 bigram（原权重）与 unigram（原权重 × UNIGRAM_DISCOUNT）。
     */
    private tokenizeFields;
    /**
     * 索引一条笔记（summary 为 AI 摘要，检索时随结果返回便于直接回答）。
     * extra 携带 frontmatter 中的 confidence / source_count / aliases。
     */
    indexNote(note: NoteMeta, content: string, summary?: string, extra?: {
        aliases?: string[];
        confidence?: string;
        sourceCount?: number;
    }): void;
    /** 移除笔记索引 */
    removeNote(notePath: string): void;
    /** 全文搜索：IDF 加权评分，归一化到 0~1 */
    search(query: string, limit?: number): SearchResult[];
    /** 重建索引 */
    rebuild(notes: Array<{
        meta: NoteMeta;
        content: string;
        summary?: string;
        extra?: {
            aliases?: string[];
            confidence?: string;
            sourceCount?: number;
        };
    }>): Promise<void>;
    /** 生成包含搜索关键词的摘录：summary 优先，content 兜底，窗口 ±60/140 */
    private generateSnippet;
    private sliceWindow;
}
