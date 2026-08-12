import { useEffect } from 'react'
import type { AppConfig } from '../../../shared/types'
import { deriveTokens, type DerivedTokens } from './derive'

/** 解析实际主题模式：auto 跟随系统亮暗（matchMedia，系统切换时自动响应） */
export function resolveMode(cfg: AppConfig): 'light' | 'dark' {
  if (cfg.theme.mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return cfg.theme.mode
}

export interface ThemeChangeEvent {
  mode: 'light' | 'dark'
  tokens: DerivedTokens
}

/** 应用主题到 document：data-theme（静态令牌分层）+ 内联 CSS 变量（用户色推导覆盖） */
function applyTheme(cfg: AppConfig): void {
  const mode = resolveMode(cfg)
  const root = document.documentElement
  root.setAttribute('data-theme', mode)

  const tokens = deriveTokens(cfg.theme.accent, cfg.theme.accent2, mode)
  const s = root.style
  s.setProperty('--accent', tokens.accent)
  s.setProperty('--accent-fg', tokens.accentFg)
  s.setProperty('--accent2', tokens.accent2)
  s.setProperty('--accent2-fg', tokens.accent2Fg)
  s.setProperty('--surface', tokens.surface)
  s.setProperty('--surface-hover', tokens.surfaceHover)
  s.setProperty('--border', tokens.border)
  s.setProperty('--border-strong', tokens.borderStrong)
  s.setProperty('--glow', tokens.glow)
  s.setProperty('--wiki-accent', tokens.wikiAccent)
  s.setProperty('--wiki-accent2', tokens.wikiAccent2)
  s.setProperty('--wiki-glow', tokens.wikiGlow)

  // 广播主题变更：canvas 图谱等非 CSS 消费者订阅后重读重绘
  document.dispatchEvent(
    new CustomEvent<ThemeChangeEvent>('winagent:theme-changed', { detail: { mode, tokens } })
  )
}

/**
 * 主题容器（不渲染 DOM）。
 * 挂载在 main.tsx，主窗口与知识库窗口共用：
 * 初始 getConfig 应用主题 → 订阅 config:changed（另一窗口改设置实时同步）→
 * auto 模式监听系统亮暗变化。
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  useEffect(() => {
    let unsubMedia: (() => void) | null = null
    let disposed = false

    const apply = (cfg: AppConfig): void => {
      if (disposed) return
      applyTheme(cfg)
      // auto 模式：监听系统亮暗变化（nativeTheme 在渲染层不可用，用 matchMedia）
      unsubMedia?.()
      if (cfg.theme.mode === 'auto') {
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = (): void => applyTheme(cfg)
        mq.addEventListener('change', onChange)
        unsubMedia = () => mq.removeEventListener('change', onChange)
      }
    }

    void window.winagent.getConfig().then(apply)
    const unsub = window.winagent.onConfigChanged(apply)
    return () => {
      disposed = true
      unsub?.()
      unsubMedia?.()
    }
  }, [])

  return <>{children}</>
}
