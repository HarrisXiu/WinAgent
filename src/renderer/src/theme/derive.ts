import { colord, extend, type Colord } from 'colord'
import a11yPlugin from 'colord/plugins/a11y'
import mixPlugin from 'colord/plugins/mix'

extend([a11yPlugin, mixPlugin])

/** RGB 通道三元组字符串（Tailwind 的 <alpha-value> 修饰符需要空格分隔通道） */
export type ChannelTriplet = string

/** 由用户主色推导出的动态令牌（ThemeProvider 以内联 style 覆盖在 data-theme 之上） */
export interface DerivedTokens {
  accent: ChannelTriplet
  accentFg: ChannelTriplet
  accent2: ChannelTriplet
  accent2Fg: ChannelTriplet
  surface: ChannelTriplet
  surfaceHover: ChannelTriplet
  border: ChannelTriplet
  borderStrong: ChannelTriplet
  glow: ChannelTriplet
  /** Wiki 图谱浮动层（由用户主色推导，自定义主色贯穿图谱） */
  wikiAccent: ChannelTriplet
  wikiAccent2: ChannelTriplet
  wikiGlow: ChannelTriplet
}

/** 深色模式背景（与 index.css [data-theme='dark'] --bg 一致） */
const DARK_BG = colord('#181824')

function triplet(c: Colord): ChannelTriplet {
  const { r, g, b } = c.toRgb()
  return `${r} ${g} ${b}`
}

/**
 * 主色上的文字色：与白色对比 ≥ 2.6 选白（保留品牌粉 #f4719c 白字按钮的默认观感），
 * 否则选近黑。极端亮色（纯白/荧光）经此兜底为黑字，不会产生白底白字。
 */
function fgFor(bg: Colord): ChannelTriplet {
  return bg.contrast('#ffffff') >= 2.6 ? '255 255 255' : '17 17 17'
}

/** 深色模式下确保主色与背景对比度 ≥ 3（WCAG AA 图形/大文本），不达标迭代提亮 */
function ensureContrast(base: Colord, bg: Colord, minContrast = 3): Colord {
  let c = base
  for (let i = 0; i < 12; i++) {
    if (bg.contrast(c) >= minContrast) break
    c = c.lighten(0.09)
  }
  return c
}

/**
 * 从用户 accent/accent2 推导完整令牌。
 * 极值输入兜底：非法 hex 回退默认粉蓝；纯黑/纯白/荧光色经对比度校验不产生不可读组合。
 */
export function deriveTokens(
  accentHex: string,
  accent2Hex: string,
  mode: 'light' | 'dark'
): DerivedTokens {
  const isDark = mode === 'dark'
  let accent = colord(accentHex || '#f4719c')
  let accent2 = colord(accent2Hex || '#6db7d9')
  if (!accent.isValid()) accent = colord('#f4719c')
  if (!accent2.isValid()) accent2 = colord('#6db7d9')

  // 深色模式：提亮主色保证与背景对比度
  if (isDark) {
    accent = ensureContrast(accent, DARK_BG)
    accent2 = ensureContrast(accent2, DARK_BG)
  }

  const neutral = isDark ? colord('#000000') : colord('#ffffff')
  // 表面/边框：主色向中性色混合（light 混白 / dark 混黑）
  const surface = accent.mix(neutral, isDark ? 0.82 : 0.9)
  const surfaceHover = accent.mix(neutral, isDark ? 0.76 : 0.82)
  const border = accent.mix(neutral, isDark ? 0.68 : 0.78)
  const borderStrong = accent.mix(neutral, isDark ? 0.6 : 0.68)

  // Wiki 图谱层：直接用用户主色（深色浮动底 + 主色节点，观感统一）
  const wikiAccent = isDark ? ensureContrast(accent, colord('#0a0a14'), 3) : accent
  const wikiAccent2 = isDark ? ensureContrast(accent2, colord('#0a0a14'), 3) : accent2

  return {
    accent: triplet(accent),
    accentFg: fgFor(accent),
    accent2: triplet(accent2),
    accent2Fg: fgFor(accent2),
    surface: triplet(surface),
    surfaceHover: triplet(surfaceHover),
    border: triplet(border),
    borderStrong: triplet(borderStrong),
    glow: triplet(accent),
    wikiAccent: triplet(wikiAccent),
    wikiAccent2: triplet(wikiAccent2),
    wikiGlow: triplet(accent)
  }
}
