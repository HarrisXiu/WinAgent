import React from 'react'
import ReactDOM from 'react-dom/client'
import './tauri-bridge'
import App from './App'
import WikiWindowApp from './components/wiki/WikiWindowApp'
import ThemeProvider from './theme/ThemeProvider'
import './index.css'

// 知识库独立窗口通过 ?view=wiki 加载同一 index.html，渲染 WikiWindowApp；主窗口渲染 App
// ThemeProvider 包在最外层：两个窗口共用同一主题系统（data-theme + 用户主色推导）
const isWikiWindow = new URLSearchParams(window.location.search).get('view') === 'wiki'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      {isWikiWindow ? <WikiWindowApp /> : <App />}
    </ThemeProvider>
  </React.StrictMode>
)
