/// <reference types="vite/client" />
import type { WinAgentApi } from '../../preload'

declare global {
  interface Window {
    winagent: WinAgentApi
  }
}

export {}
