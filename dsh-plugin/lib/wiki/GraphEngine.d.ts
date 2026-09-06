import type { GraphData, GraphNode } from '../shared/types';
export interface GraphInput {
    path: string;
    title: string;
    tags: string[];
    links: string[];
    /** AI 分析发现的关系目标（relPath，来自 frontmatter aiRelations）：生成 ai 型边入图 */
    aiRelations?: string[];
}
/**
 * 关系图谱引擎
 * 从笔记集合构建节点和边，计算度数/强度，支持邻域查询
 */
export declare class GraphEngine {
    private graph;
    private nodeMap;
    private edgeSet;
    /** 从笔记数据重建全量图谱 */
    rebuild(inputs: GraphInput[]): GraphData;
    /** 获取全量图谱数据 */
    getData(): GraphData;
    /** 获取单个节点 */
    getNode(id: string): GraphNode | null;
    /**
     * 获取某节点的 k-hop 邻域子图
     * @param id 中心节点 id
     * @param hops 跳数，默认 1
     */
    getNeighborhood(id: string, hops?: number): GraphData;
    /** 获取反向链接节点 id 列表 */
    getBacklinkIds(targetId: string): string[];
}
