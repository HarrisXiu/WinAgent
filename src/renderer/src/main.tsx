import React from 'react'
import ReactDOM from 'react-dom/client'
import './drag-shim'
import App from './App'
import WikiWindowApp from './components/wiki/WikiWindowApp'
import ThemeProvider from './theme/ThemeProvider'
import SkinProvider from './theme/SkinProvider'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// 知识库独立窗口通过 ?view=wiki 加载同一 index.html，渲染 WikiWindowApp；主窗口渲染 App
// ThemeProvider 包在最外层：两个窗口共用同一主题系统（data-theme + 用户主色推导）
// SkinProvider 与之并列：主题包（吉祥物立绘/头像/文案）双窗口同步
const isWikiWindow = new URLSearchParams(window.location.search).get('view') === 'wiki'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* ⚠️ 白屏 bug 防回归：根错误边界必须包在最外层（含 Theme/SkinProvider）。
        没有它时任何渲染异常都会卸载整棵树 → 启动白屏；有它则显示报错 + 重载按钮。勿删。 */}
    <ErrorBoundary>
      <ThemeProvider>
        <SkinProvider>
          {isWikiWindow ? <WikiWindowApp /> : <App />}
        </SkinProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
