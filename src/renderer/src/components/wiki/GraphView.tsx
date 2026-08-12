import { useEffect, useRef, useCallback, useState } from 'react'
import { X, Maximize2, Minimize2, Crosshair, Move } from 'lucide-react'
import type { GraphData, GraphNode, GraphEdge } from '../../../../shared/types'

interface Props {
  data: GraphData | null
  onNodeClick: (nodeId: string) => void
  onClose: () => void
}

// === Canvas 主题调色板（读 CSS 变量，随用户主色/主题模式变化） ===
type RGB = [number, number, number]

interface CanvasPalette {
  bg: string
  grid: string
  edgeLink: string          // 三元组 "r, g, b"（供 rgba() 模板拼接）
  edgeAi: string
  edgeTag: string
  glowHover: string[]       // 光晕渐变 stops
  glowNeighbor: string[]
  glowDefault: string[]
  ballHover: string[]       // 主球渐变 stops
  ballNeighbor: string[]
  ballDefault: string[]
  ringHover: string
  ringNeighbor: string
  tooltipBg: string
  tooltipBorder: string
  tooltipTitle: string
  tooltipTag: string
  tooltipLine: string
  particle: string
}

function readVar(name: string): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const parts = v.split(/\s+/).map(Number)
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2]]
  }
  return [10, 10, 20]
}

const rgba = (c: RGB, a: number): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
const mixC = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
]

/** 从 CSS 变量构建完整调色板（用户自定义主色贯穿图谱） */
function readPalette(): CanvasPalette {
  const canvas = readVar('--wiki-canvas')
  const accent = readVar('--wiki-accent')
  const accent2 = readVar('--wiki-accent2')
  const glow = readVar('--wiki-glow')
  const white: RGB = [255, 255, 255]
  const black: RGB = [0, 0, 0]

  return {
    bg: `rgb(${canvas.join(' ')})`,
    grid: rgba(mixC(accent, black, 0.55), 0.05),
    edgeLink: accent.join(', '),
    edgeAi: accent2.join(', '),
    edgeTag: '100, 100, 150',
    glowHover: [rgba(mixC(white, accent, 0.15), 0.9), rgba(accent, 0.5), rgba(mixC(accent, black, 0.6), 0)],
    glowNeighbor: [rgba(mixC(white, accent, 0.25), 0.6), rgba(mixC(accent, black, 0.2), 0.25), rgba(mixC(accent, black, 0.55), 0)],
    glowDefault: [rgba(mixC(white, accent, 0.4), 0.5), rgba(mixC(accent, black, 0.15), 0.15), rgba(mixC(accent, black, 0.6), 0)],
    ballHover: ['#ffffff', rgba(mixC(white, accent, 0.2), 1), rgba(mixC(white, accent, 0.55), 1), rgba(mixC(accent, black, 0.35), 1)],
    ballNeighbor: [rgba(mixC(white, accent, 0.08), 1), rgba(accent, 1), rgba(mixC(accent, black, 0.25), 1), rgba(mixC(accent, black, 0.5), 1)],
    ballDefault: [rgba(mixC(white, accent, 0.15), 1), rgba(mixC(white, accent, 0.4), 1), rgba(mixC(accent, black, 0.4), 1), rgba(mixC(accent, black, 0.65), 1)],
    ringHover: rgba(mixC(white, accent, 0.2), 0.8),
    ringNeighbor: rgba(accent, 0.4),
    tooltipBg: rgba(mixC(canvas, black, 0.5), 0.88),
    tooltipBorder: rgba(accent, 0.5),
    tooltipTitle: rgba(mixC(white, accent, 0.08), 1),
    tooltipTag: rgba(mixC(white, accent, 0.3), 0.8),
    tooltipLine: rgba(accent, 0.3),
    particle: mixC(accent2, white, 0.35).join(', ')
  }
}

// === 力导向布局参数 ===
const REPULSION = 800
const ATTRACTION = 0.005
const DAMPING = 0.88
const MAX_SPEED = 4
const MIN_SPEED = 0.05
const EDGE_SPRING_LEN = 120

// === 量子背景粒子 ===
interface Particle {
  x: number; y: number
  vx: number; vy: number
  size: number; alpha: number
  phase: number
}

// === 可视化节点 ===
interface VisNode extends GraphNode {
  x: number; y: number
  vx: number; vy: number
}

export default function GraphView({ data, onNodeClick, onClose }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 画布交互状态
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(0.85)
  const [minimized, setMinimized] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Canvas 主题调色板：初始读 CSS 变量；主题变更（winagent:theme-changed）时重读
  const [palette, setPalette] = useState<CanvasPalette>(() => readPalette())

  // 持久引用（避免 rAF 闭包陈旧）
  const panRef = useRef(pan); panRef.current = pan
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const hoveredRef = useRef(hoveredId); hoveredRef.current = hoveredId
  const dataRef = useRef(data); dataRef.current = data
  const paletteRef = useRef(palette); paletteRef.current = palette

  // 订阅主题变更：重读调色板（rAF 循环下一帧自动生效）
  useEffect(() => {
    const onTheme = (): void => setPalette(readPalette())
    document.addEventListener('winagent:theme-changed', onTheme)
    return () => document.removeEventListener('winagent:theme-changed', onTheme)
  }, [])

  // 力布局节点
  const nodesRef = useRef<Map<string, VisNode>>(new Map())
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef(0)
  const dragRef = useRef<{
    active: boolean; nodeId?: string
    startX: number; startY: number
    panelDrag: boolean
  }>({ active: false, panelDrag: false, startX: 0, startY: 0 })
  const layoutStable = useRef(false)

  // === 初始化/更新力布局 ===
  useEffect(() => {
    if (!data || !canvasRef.current) return
    const canvas = canvasRef.current
    const w = canvas.width
    const h = canvas.height
    const cx = w / 2
    const cy = h / 2

    const existing = nodesRef.current
    const next = new Map<string, VisNode>()

    for (const n of data.nodes) {
      const prev = existing.get(n.id)
      if (prev) {
        next.set(n.id, prev)
      } else {
        // 新节点：围绕中心随机散射
        const angle = Math.random() * Math.PI * 2
        const radius = 30 + Math.random() * 80
        next.set(n.id, {
          ...n,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          vx: 0, vy: 0
        })
      }
    }
    // 移除已删除的节点
    nodesRef.current = next
    layoutStable.current = false
  }, [data])

  // === 初始化背景粒子 ===
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const particles: Particle[] = []
    for (let i = 0; i < 35; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 0.6 + Math.random() * 1.8,
        alpha: 0.15 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2
      })
    }
    particlesRef.current = particles
  }, [])

  // === Canvas 尺寸 ===
  useEffect(() => {
    const resize = (): void => {
      const container = containerRef.current
      const canvas = canvasRef.current
      if (!container || !canvas) return
      const dpr = window.devicePixelRatio || 1
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [minimized])

  // === 主渲染循环 ===
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let running = true

    const tick = (): void => {
      if (!running) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const currentData = dataRef.current
      const currentPan = panRef.current
      const currentZoom = zoomRef.current
      const nodes = nodesRef.current
      const particles = particlesRef.current
      const p = paletteRef.current

      // 清屏
      ctx.clearRect(0, 0, w, h)

      // 深空背景（CSS 变量：跟随用户主色/主题）
      ctx.fillStyle = p.bg
      ctx.fillRect(0, 0, w, h)

      // 网格（微弱的量子空间网格）
      ctx.strokeStyle = p.grid
      ctx.lineWidth = 0.5
      const gridSize = 40
      for (let x = currentPan.x % gridSize; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let y = currentPan.y % gridSize; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }

      // 变换
      ctx.save()
      ctx.translate(currentPan.x + w / 2, currentPan.y + h / 2)
      ctx.scale(currentZoom, currentZoom)

      // === 绘制边 ===
      if (currentData) {
        for (const edge of currentData.edges) {
          const s = nodes.get(edge.source)
          const t = nodes.get(edge.target)
          if (!s) continue

          // 边颜色（link=主色 / ai=辅色 / tag=中性灰）
          let color: string
          let alpha = 0.3
          if (edge.type === 'link') { color = p.edgeLink; alpha = 0.45 }
          else if (edge.type === 'ai') { color = p.edgeAi; alpha = 0.55 }
          else { color = p.edgeTag; alpha = 0.15 }

          // 对 tag 边大量弱化
          if (edge.type === 'tag' && s.degree > 8) alpha *= 0.5

          if (t) {
            // 贝塞尔曲线
            const mx = (s.x + t.x) / 2 + (Math.random() - 0.5) * 20
            const my = (s.y + t.y) / 2 + (Math.random() - 0.5) * 20
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.quadraticCurveTo(mx, my, t.x, t.y)
            ctx.strokeStyle = `rgba(${color}, ${alpha})`
            ctx.lineWidth = edge.weight * 0.7
            ctx.stroke()

            // 发光叠加
            ctx.globalCompositeOperation = 'lighter'
            ctx.strokeStyle = `rgba(${color}, ${alpha * 0.35})`
            ctx.lineWidth = edge.weight * 2.0
            ctx.stroke()
            ctx.globalCompositeOperation = 'source-over'
          } else if (t === undefined) {
            // 孤立链接目标（指向外部或缺失笔记）
            const angle = Math.atan2(
              (s.y || 0) - (s.y || 0) + 1,  // tiny angle
              (s.x || 0) - (s.x || 0) + 1
            )
            // draw dangling line
          }
        }
      }

      // === 绘制节点 ===
      const hovered = hoveredRef.current
      const neighborSet = new Set<string>()
      if (hovered && currentData) {
        neighborSet.add(hovered)
        for (const e of currentData.edges) {
          if (e.source === hovered) neighborSet.add(e.target)
          if (e.target === hovered) neighborSet.add(e.source)
        }
      }

      nodes.forEach((node) => {
        const isHovered = node.id === hovered
        const isNeighbor = neighborSet.has(node.id)
        const highlight = isHovered || isNeighbor
        const r = 4 + node.strength * 12

        // 光晕（由用户主色推导的渐变档位）
        const glowGrad = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, r * 2.2)
        if (isHovered) {
          glowGrad.addColorStop(0, p.glowHover[0])
          glowGrad.addColorStop(0.4, p.glowHover[1])
          glowGrad.addColorStop(1, p.glowHover[2])
        } else if (isNeighbor) {
          glowGrad.addColorStop(0, p.glowNeighbor[0])
          glowGrad.addColorStop(0.6, p.glowNeighbor[1])
          glowGrad.addColorStop(1, p.glowNeighbor[2])
        } else {
          glowGrad.addColorStop(0, p.glowDefault[0])
          glowGrad.addColorStop(0.6, p.glowDefault[1])
          glowGrad.addColorStop(1, p.glowDefault[2])
        }
        ctx.beginPath()
        ctx.arc(node.x, node.y, r * 2.2, 0, Math.PI * 2)
        ctx.fillStyle = glowGrad
        ctx.fill()

        // 主球体（径向渐变：由用户主色推导的高光→主色→暗色档位）
        const grad = ctx.createRadialGradient(node.x - r * 0.25, node.y - r * 0.25, r * 0.05, node.x, node.y, r)
        if (isHovered) {
          grad.addColorStop(0, p.ballHover[0])
          grad.addColorStop(0.35, p.ballHover[1])
          grad.addColorStop(0.75, p.ballHover[2])
          grad.addColorStop(1, p.ballHover[3])
        } else if (isNeighbor) {
          grad.addColorStop(0, p.ballNeighbor[0])
          grad.addColorStop(0.4, p.ballNeighbor[1])
          grad.addColorStop(0.8, p.ballNeighbor[2])
          grad.addColorStop(1, p.ballNeighbor[3])
        } else {
          grad.addColorStop(0, p.ballDefault[0])
          grad.addColorStop(0.45, p.ballDefault[1])
          grad.addColorStop(0.85, p.ballDefault[2])
          grad.addColorStop(1, p.ballDefault[3])
        }
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()

        // 高光环
        if (highlight) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2)
          ctx.strokeStyle = isHovered ? p.ringHover : p.ringNeighbor
          ctx.lineWidth = isHovered ? 2 : 1.2
          ctx.stroke()
        }

        // 标签（仅悬停时显示）
        if (isHovered) {
          const fontSize = 13
          ctx.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`
          const textW = ctx.measureText(node.label).width
          const tagStr = node.tags.length > 0 ? node.tags.slice(0, 3).join(' · ') : ''
          ctx.font = `400 ${fontSize * 0.75}px "Microsoft YaHei", sans-serif`
          const tagW = tagStr ? ctx.measureText(tagStr).width : 0
          const boxW = Math.max(textW, tagW) + 20
          const boxH = tagStr ? 52 : 32

          // 标签背景（深色浮动层，主色描边）
          ctx.fillStyle = p.tooltipBg
          ctx.strokeStyle = p.tooltipBorder
          ctx.lineWidth = 1
          const bx = node.x - boxW / 2
          const by = node.y - r - boxH - 10
          ctx.beginPath()
          ctx.roundRect(bx, by, boxW, boxH, 8)
          ctx.fill()
          ctx.stroke()

          // 文字
          ctx.fillStyle = p.tooltipTitle
          ctx.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(node.label, node.x, by + 20)

          if (tagStr) {
            ctx.fillStyle = p.tooltipTag
            ctx.font = `400 ${fontSize * 0.75}px "Microsoft YaHei", sans-serif`
            ctx.fillText(tagStr, node.x, by + 38)
          }

          // 连接线
          ctx.beginPath()
          ctx.moveTo(node.x, bx + boxW / 2 > node.x ? Math.max(node.x, bx) : Math.min(node.x, bx + boxW))
          // simplified: just a line from node to box
          ctx.moveTo(node.x, node.y - r)
          ctx.lineTo(node.x, by + boxH)
          ctx.strokeStyle = p.tooltipLine
          ctx.lineWidth = 1
          ctx.stroke()
        }
      })

      ctx.restore()

      // === 背景量子粒子（不受 zoom/pan 影响） ===
      const t = Date.now() * 0.001
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < -10) p.x = w + 10
        if (p.x > w + 10) p.x = -10
        if (p.y < -10) p.y = h + 10
        if (p.y > h + 10) p.y = -10

        const flicker = 0.6 + 0.4 * Math.sin(t * 1.5 + p.phase)
        const alpha = p.alpha * flicker
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${paletteRef.current.particle}, ${alpha})`
        ctx.fill()
      }

      // === 力导向布局更新 ===
      if (currentData && !layoutStable.current) {
        const nodeArr = [...nodes.values()]
        let maxForce = 0

        // 斥力 (Coulomb)
        for (let i = 0; i < nodeArr.length; i++) {
          for (let j = i + 1; j < nodeArr.length; j++) {
            const a = nodeArr[i]; const b = nodeArr[j]
            let dx = a.x - b.x; let dy = a.y - b.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const force = REPULSION / (dist * dist)
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force
            a.vx += fx; a.vy += fy
            b.vx -= fx; b.vy -= fy
            maxForce = Math.max(maxForce, Math.abs(fx))
          }
        }

        // 引力 (Hooke)
        for (const edge of currentData.edges) {
          const a = nodes.get(edge.source)
          const b = nodes.get(edge.target)
          if (!a || !b) continue
          let dx = b.x - a.x; let dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const displacement = dist - EDGE_SPRING_LEN / (edge.weight || 1)
          const force = ATTRACTION * displacement
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx += fx; a.vy += fy
          b.vx -= fx; b.vy -= fy
        }

        // 中心引力（防止散开）
        for (const node of nodeArr) {
          node.vx -= node.x * 0.0003
          node.vy -= node.y * 0.0003
        }

        // 速度限制 + 阻尼
        for (const node of nodeArr) {
          const speed = Math.sqrt(node.vx ** 2 + node.vy ** 2)
          if (speed > MAX_SPEED) {
            node.vx = (node.vx / speed) * MAX_SPEED
            node.vy = (node.vy / speed) * MAX_SPEED
          }
          node.vx *= DAMPING
          node.vy *= DAMPING
          node.x += node.vx
          node.y += node.vy
        }

        // 判断稳定
        if (maxForce < 0.08 && nodeArr.every((n) => Math.abs(n.vx) < MIN_SPEED && Math.abs(n.vy) < MIN_SPEED)) {
          layoutStable.current = true
        }
      }

      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  // === 交互：鼠标 ===
  const findNodeAt = useCallback((wx: number, wy: number): string | null => {
    const nodes = nodesRef.current
    let best: string | null = null
    let bestDist = Infinity
    nodes.forEach((node) => {
      const r = 6 + node.strength * 14
      const dx = node.x - wx
      const dy = node.y - wy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < r && dist < bestDist) {
        bestDist = dist
        best = node.id
      }
    })
    return best
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const x = (e.clientX - rect.left) * (canvas.width / dpr / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / dpr / rect.height)
    const wp = panRef.current
    const wz = zoomRef.current
    const wx = (x - wp.x - canvas.width / dpr / 2) / wz
    const wy = (y - wp.y - canvas.height / dpr / 2) / wz

    const nodeId = findNodeAt(wx, wy)
    dragRef.current = {
      active: true,
      nodeId: nodeId || undefined,
      startX: e.clientX,
      startY: e.clientY,
      panelDrag: !nodeId
    }
  }, [findNodeAt])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const x = (e.clientX - rect.left) * (canvas.width / dpr / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / dpr / rect.height)
    const wp = panRef.current
    const wz = zoomRef.current
    const wx = (x - wp.x - canvas.width / dpr / 2) / wz
    const wy = (y - wp.y - canvas.height / dpr / 2) / wz

    const dr = dragRef.current
    if (dr.active) {
      if (dr.panelDrag) {
        const dx = e.clientX - dr.startX
        const dy = e.clientY - dr.startY
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
        dr.startX = e.clientX
        dr.startY = e.clientY
      } else if (dr.nodeId && nodesRef.current.has(dr.nodeId)) {
        // 拖拽节点
        const node = nodesRef.current.get(dr.nodeId)!
        node.x = wx
        node.y = wy
        node.vx = 0; node.vy = 0
        layoutStable.current = false
      }
    } else {
      // 悬停检测
      const nodeId = findNodeAt(wx, wy)
      setHoveredId(nodeId)
    }
  }, [findNodeAt])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const dr = dragRef.current
    if (dr.active && dr.nodeId && !dr.panelDrag) {
      const dx = Math.abs(e.clientX - dr.startX)
      const dy = Math.abs(e.clientY - dr.startY)
      if (dx < 4 && dy < 4) {
        // 点击行为
        onNodeClick(dr.nodeId)
      }
    }
    dragRef.current = { active: false, panelDrag: false, startX: 0, startY: 0 }
  }, [onNodeClick])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.92 : 1.08
    setZoom((z) => Math.max(0.25, Math.min(2.5, z * delta)))
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null)
    dragRef.current = { active: false, panelDrag: false, startX: 0, startY: 0 }
  }, [])

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 })
    setZoom(0.85)
    layoutStable.current = false
  }, [])

  // 面板拖拽（标题栏）
  const handlePanelDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const orig = position

    const onMove = (ev: MouseEvent): void => {
      setPosition({ x: orig.x + ev.clientX - startX, y: orig.y + ev.clientY - startY })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    setDragging(true)
    setTimeout(() => setDragging(false), 100)
  }, [position])

  if (minimized) {
    return (
      <div
        className="fixed z-50 rounded-lg border border-accent/30 bg-wiki-dark/95 shadow-lg shadow-accent/10 backdrop-blur"
        style={{ bottom: 16, right: 16 }}
      >
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-accent/80 hover:text-accent transition-colors"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          图谱
        </button>
      </div>
    )
  }

  return (
    <div
      className="wiki-graph-panel"
      style={{
        left: position.x || undefined,
        top: position.y || undefined
      }}
    >
      {/* 标题栏 — 可拖拽 */}
      <div
        className="flex items-center justify-between border-b border-accent/15 px-3 py-2 cursor-move select-none"
        onMouseDown={handlePanelDrag}
      >
        <div className="flex items-center gap-2">
          <Move className={`h-3.5 w-3.5 ${dragging ? 'text-accent' : 'text-muted/60'}`} />
          <span className="text-[12px] font-medium text-purple/80">量子关系图谱</span>
          <span className="rounded-full bg-accent/10 px-2 py-0 text-[10px] text-accent/70">
            {data ? `${data.nodes.length} 节点` : '加载中'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={resetView}
            className="rounded p-1 text-muted/60 hover:text-accent transition-colors"
            title="重置视图"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="rounded p-1 text-muted/60 hover:text-accent transition-colors"
            title="最小化"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted/60 hover:text-danger transition-colors"
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas 区域 */}
      <div ref={containerRef} className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
        />

        {/* 空状态 */}
        {(!data || data.nodes.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-4xl mb-2 opacity-40">✦</div>
              <p className="text-[13px] text-purple/40">
                {data ? '图谱为空，创建笔记并添加 [[链接]]' : '加载图谱数据...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
