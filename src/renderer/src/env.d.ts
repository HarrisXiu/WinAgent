/// <reference types="vite/client" />

// window.winagent 的 API 形状：由 preload（contextBridge.exposeInMainWorld）注入，
// 与 src/preload/index.ts 的暴露面一致。这里取 preload 模块导出的 API 类型。
import type { WinAgentApi } from '../../preload/index'

declare global {
  interface Window {
    winagent: WinAgentApi
  }
}

export {}
