/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#fff8f4',
        panel: '#ffffff',
        border: '#f5dfe8',
        accent: '#f4719c',
        accent2: '#6db7d9',
        muted: '#a38d97',
        // Wiki 暗色主题色
        'wiki-dark': '#0a0a14',
        'wiki-panel': '#12121f',
        'wiki-border': '#1e1e32',
        'wiki-accent': '#c084fc',
        'wiki-accent2': '#60a5fa',
        'wiki-glow': '#a855f7'
      },
      boxShadow: {
        glow: '0 4px 20px rgba(244, 113, 156, 0.35)',
        'glow-lg': '0 8px 40px rgba(244, 113, 156, 0.4)',
        card: '0 2px 12px rgba(163, 118, 140, 0.1)'
      }
    }
  },
  plugins: []
}
