/** 只用现有的 accent/accent2 保存方案；旧配置和自定义颜色无需迁移。 */
export const COLOR_SCHEMES = [
  { id: 'classic', name: '经典粉蓝', description: '原版默认', accent: '#f4719c', accent2: '#6db7d9' },
  { id: 'coral', name: '珊瑚琥珀', description: '暖色方案', accent: '#e0603f', accent2: '#f0a04b' },
  { id: 'ocean', name: '深海蓝', description: '冷色方案', accent: '#315f9e', accent2: '#6b8fb9' }
] as const

export type ColorSchemeId = (typeof COLOR_SCHEMES)[number]['id'] | 'custom'

export function matchColorScheme(accent: string, accent2: string): ColorSchemeId {
  return COLOR_SCHEMES.find(
    (scheme) => scheme.accent === accent?.toLowerCase() && scheme.accent2 === accent2?.toLowerCase()
  )?.id || 'custom'
}
