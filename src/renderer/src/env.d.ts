/// <reference types="vite/client" />
import type { WinAgentApi } from '../../preload'

declare global {
  interface Window {
    winagent: WinAgentApi
  }
}

export {}

// 扩展 Window 以支持 Electron 文件拖拽
declare global {
  interface DataTransferItem {
    path?: string
  }
}
