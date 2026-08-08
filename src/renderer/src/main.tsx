import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import WikiWindowApp from './components/wiki/WikiWindowApp'
import './index.css'

// 知识库独立窗口通过 ?view=wiki 加载同一 index.html，渲染 WikiWindowApp；主窗口渲染 App
const isWikiWindow = new URLSearchParams(window.location.search).get('view') === 'wiki'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isWikiWindow ? <WikiWindowApp /> : <App />}
  </React.StrictMode>
)
