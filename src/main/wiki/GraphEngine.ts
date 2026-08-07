import type { NoteMeta, NoteContent, GraphData, GraphNode, GraphEdge } from '../../shared/types'

export interface GraphInput {
  path: string    // 相对路径 "folder/note.md"
  title: string
  tags: string[]
  links: string[] // [[wiki link]] 目标
}

/**
 * 关系图谱引擎
 * 从笔记集合构建节点和边，计算度数/强度，支持邻域查询
 */
export class GraphEngine {
  private graph: GraphData = { nodes: [], edges: [] }
  private nodeMap = new Map<string, GraphNode>()
  private edgeSet = new Set<string>()

  /** 从笔记数据重建全量图谱 */
  rebuild(inputs: GraphInput[]): GraphData {
    this.nodeMap.clear()
    this.edgeSet.clear()
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    // 收集所有已知节点 id
    const knownIds = new Set(inputs.map((n) => n.path.replace(/\.md$/, '')))
    // 按标签分组（用于生成 tag 型边）
    const tagToNodes = new Map<string, string[]>()

    // 1) 构建节点
    for (const input of inputs) {
      const id = input.path.replace(/\.md$/, '')
      const node: GraphNode = {
        id,
        label: input.title,
        tags: input.tags,
        degree: 0,
        strength: 0
      }
      nodes.push(node)
      this.nodeMap.set(id, node)
      for (const tag of input.tags) {
        const list = tagToNodes.get(tag) || []
        list.push(id)
        tagToNodes.set(tag, list)
      }
    }

    // 辅助：添加边（去重）
    const addEdge = (source: string, target: string, type: GraphEdge['type'], weight: number): void => {
      if (source === target) return
      const key = [source, target].sort().join('::') + `::${type}`
      if (this.edgeSet.has(key)) return
      this.edgeSet.add(key)
      edges.push({ source, target, type, weight })
    }

    // 2) 构建 link 边 — 直接的 [[wiki link]]
    for (const input of inputs) {
      const sourceId = input.path.replace(/\.md$/, '')
      for (const rawLink of input.links) {
        const normalized = rawLink.replace(/\\/g, '/')
        if (knownIds.has(normalized)) {
          addEdge(sourceId, normalized, 'link', 2)
        }
      }
    }

    // 3) 构建 tag 边 — 共享相同标签的笔记对
    for (const [, nodeIds] of tagToNodes) {
      if (nodeIds.length < 2) continue
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          addEdge(nodeIds[i], nodeIds[j], 'tag', 1)
        }
      }
    }

    // 4) 计算度数和强度
    const degreeMap = new Map<string, number>()
    for (const edge of edges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1)
      degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1)
    }
    const maxDegree = Math.max(1, ...degreeMap.values())
    for (const node of nodes) {
      const d = degreeMap.get(node.id) || 0
      node.degree = d
      node.strength = maxDegree > 0 ? d / maxDegree : 0
      this.nodeMap.set(node.id, node)
    }

    this.graph = { nodes, edges }
    return this.graph
  }

  /** 获取全量图谱数据 */
  getData(): GraphData {
    return this.graph
  }

  /** 获取单个节点 */
  getNode(id: string): GraphNode | null {
    return this.nodeMap.get(id) ?? null
  }

  /**
   * 获取某节点的 k-hop 邻域子图
   * @param id 中心节点 id
   * @param hops 跳数，默认 1
   */
  getNeighborhood(id: string, hops = 1): GraphData {
    if (!this.nodeMap.has(id)) return { nodes: [], edges: [] }

    const visited = new Set<string>()
    const queue: Array<{ id: string; dist: number }> = [{ id, dist: 0 }]
    visited.add(id)

    // BFS
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]
      if (current.dist >= hops) continue
      for (const edge of this.graph.edges) {
        let neighbor = ''
        if (edge.source === current.id) neighbor = edge.target
        else if (edge.target === current.id) neighbor = edge.source
        else continue
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push({ id: neighbor, dist: current.dist + 1 })
        }
      }
    }

    const subNodes = this.graph.nodes.filter((n) => visited.has(n.id))
    const subEdges = this.graph.edges.filter(
      (e) => visited.has(e.source) && visited.has(e.target)
    )

    return { nodes: subNodes, edges: subEdges }
  }

  /** 获取反向链接节点 id 列表 */
  getBacklinkIds(targetId: string): string[] {
    const sources = new Set<string>()
    for (const edge of this.graph.edges) {
      if (edge.type !== 'link') continue
      if (edge.target === targetId) sources.add(edge.source)
    }
    return [...sources]
  }
}
