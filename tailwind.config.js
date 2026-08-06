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
        muted: '#a38d97'
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
