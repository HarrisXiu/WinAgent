/**
 * 启动等待窗（Apple 风格）：app ready 后立即弹出的无边框小窗，覆盖「服务核心装配 →
 * 主窗口首帧」之间的空窗期；主窗口 ready-to-show 后淡出关闭。
 *
 * 页面是自包含的 data: URL（不依赖 vite dev server / 打包路径，秒开）。
 * 同一份 HTML 也由 scripts/build-splash.cjs 渲染成 build/splash.bmp，
 * 作为 portable exe 解压阶段的启动图——两段等待画面一致。
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { readFileSync } from 'fs'
import path from 'path'
import splashTemplate from './splash.html?raw'

let splash: BrowserWindow | null = null

/**
 * 服务核心还没装配，读不到 ConfigStore：直接窥视 config.json 的 theme 段，
 * 让启动窗与用户主题（亮暗 + 配色方案）一致；异常时回落原版粉蓝。
 */
function peekTheme(dataDir: string): { dark: boolean; accent: string; accent2: string; scheme: string } {
  let mode = 'auto'
  let accent = '#f4719c'
  let accent2 = '#6db7d9'
  try {
    const cfg = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf-8'))
    if (['light', 'dark', 'auto'].includes(cfg?.theme?.mode)) mode = cfg.theme.mode
    const a = String(cfg?.theme?.accent || '')
    const b = String(cfg?.theme?.accent2 || '')
    if (/^#[0-9a-f]{6}$/i.test(a)) accent = a
    if (/^#[0-9a-f]{6}$/i.test(b)) accent2 = b
  } catch {
    /* 首次启动无配置 */
  }
  const dark = mode === 'dark' || (mode === 'auto' && nativeTheme.shouldUseDarkColors)
  const pair = `${accent.toLowerCase()}|${accent2.toLowerCase()}`
  const scheme = pair === '#f4719c|#6db7d9' ? 'classic'
    : pair === '#e0603f|#f0a04b' ? 'coral'
      : pair === '#315f9e|#6b8fb9' ? 'ocean' : 'custom'
  return { dark, accent, accent2, scheme }
}

/** 填充模板占位符（scripts/build-splash.cjs 用同样的规则生成 BMP） */
export function renderSplashHtml(opts: { dark: boolean; accent: string; accent2: string; scheme: string; version: string; staticMode?: boolean }): string {
  return splashTemplate
    .replace(/__THEME__/g, opts.dark ? 'dark' : 'light')
    .replace(/__ACCENT__/g, opts.accent)
    .replace(/__ACCENT2__/g, opts.accent2)
    .replace(/__SCHEME__/g, opts.scheme)
    .replace(/__VERSION__/g, opts.version)
    .replace(/__MODE__/g, opts.staticMode ? 'static' : 'live')
}

export function createSplashWindow(dataDir: string, version: string): void {
  const theme = peekTheme(dataDir)
  splash = new BrowserWindow({
    width: 380,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // 保留任务栏按钮：用户双击后能在任务栏看到程序已在启动
    skipTaskbar: false,
    show: false,
    center: true,
    title: 'WinAgent',
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  splash.once('ready-to-show', () => splash?.show())
  splash.on('closed', () => {
    splash = null
  })
  const html = renderSplashHtml({ ...theme, version })
  void splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
}

export function getSplashWindow(): BrowserWindow | null {
  return splash && !splash.isDestroyed() ? splash : null
}

/** 更新阶段文案（真实进度，不做假进度条） */
export function setSplashStage(text: string): void {
  const w = getSplashWindow()
  if (!w) return
  void w.webContents.executeJavaScript(`window.setStage && window.setStage(${JSON.stringify(text)})`).catch(() => {})
}

/** 淡出后关闭；immediate=true 用于启动失败时立即让出焦点给错误弹窗 */
export function closeSplash(immediate = false): void {
  const w = getSplashWindow()
  if (!w) return
  if (immediate) {
    w.destroy()
    return
  }
  void w.webContents.executeJavaScript(`document.documentElement.classList.add('out')`).catch(() => {})
  setTimeout(() => getSplashWindow()?.destroy(), 220)
}
