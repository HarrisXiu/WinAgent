/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // === 语义色（CSS 变量驱动，RGB 通道格式以支持 /alpha 透明度修饰符） ===
        // 静态令牌（data-theme 决定）：bg/panel/text/muted/md-* 与功能色
        bg: 'rgb(var(--bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        // 动态令牌（由用户 accent/accent2 经 colord 推导，内联覆盖）：surface/border/accent/glow
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        muted: 'rgb(var(--text-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        accent2: 'rgb(var(--accent2) / <alpha-value>)',
        'accent2-fg': 'rgb(var(--accent2-fg) / <alpha-value>)',
        glow: 'rgb(var(--glow) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        purple: 'rgb(var(--purple) / <alpha-value>)',
        // Wiki 图谱浮动层（独立深色色板，不随主主题）
        'wiki-dark': 'rgb(var(--wiki-canvas) / <alpha-value>)',
        'wiki-panel': 'rgb(var(--wiki-panel) / <alpha-value>)',
        'wiki-border': 'rgb(var(--wiki-border) / <alpha-value>)',
        'wiki-accent': 'rgb(var(--wiki-accent) / <alpha-value>)',
        'wiki-accent2': 'rgb(var(--wiki-accent2) / <alpha-value>)',
        'wiki-glow': 'rgb(var(--wiki-glow) / <alpha-value>)'
      },
      boxShadow: {
        glow: '0 4px 20px rgb(var(--glow) / 0.35)',
        'glow-lg': '0 8px 40px rgb(var(--glow) / 0.4)',
        card: '0 2px 12px rgb(var(--border-strong) / 0.25)'
      }
    }
  },
  plugins: []
}
