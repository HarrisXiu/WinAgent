/**
 * 主题包容器（不渲染 DOM）：与 ThemeProvider 并列挂在 main.tsx。
 * 订阅 config:changed（切主题包）+ skins.onChanged（自定义包增删/换槽位），
 * 经 context 下发 ResolvedSkin；自定义包被删除时自动回退普通主题。
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { AppConfig, SkinMeta } from '../../../shared/types'
import { PLAIN_SKIN, resolveAngelinaSkin, resolveSkin, type ResolvedSkin } from './skins'

const SkinContext = createContext<ResolvedSkin>(PLAIN_SKIN)

export function useSkin(): ResolvedSkin {
  return useContext(SkinContext)
}

export default function SkinProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [skin, setSkin] = useState<ResolvedSkin>(PLAIN_SKIN)
  const customRef = useRef<SkinMeta[]>([])
  const cfgRef = useRef<AppConfig | null>(null)
  // 异步解析的世代号：防止慢速的旧解析覆盖新选择（如 angelina → plain 立即切回）
  const reqRef = useRef(0)

  const apply = (): void => {
    const cfg = cfgRef.current
    if (!cfg) return
    const req = ++reqRef.current
    const sid = cfg.theme?.skin || 'plain'
    if (sid === 'angelina') {
      void resolveAngelinaSkin().then((s) => {
        if (req === reqRef.current) setSkin(s)
      })
      return
    }
    setSkin(resolveSkin(sid, customRef.current))
  }

  useEffect(() => {
    // 配置与自定义包列表都就绪后再解析一次，避免 custom 皮肤在列表到达前误回退
    void window.winagent.getConfig().then((c) => {
      cfgRef.current = c
      apply()
    })
    void window.winagent.skins.list().then((list) => {
      customRef.current = list
      apply()
    })
    const offCfg = window.winagent.onConfigChanged((c) => {
      cfgRef.current = c
      apply()
    })
    const offSkins = window.winagent.skins.onChanged((list) => {
      customRef.current = list
      apply()
    })
    return () => {
      offCfg()
      offSkins()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <SkinContext.Provider value={skin}>{children}</SkinContext.Provider>
}
