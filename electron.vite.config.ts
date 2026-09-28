import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

export default defineConfig({
  main: {
    // mathml2omml / temml 为 ESM-only，不能被 externalize（主进程为 CJS，require ESM 会报 ERR_REQUIRE_ESM），
    // 需交给 rollup 打包进 bundle
    plugins: [externalizeDepsPlugin({ exclude: ['mathml2omml', 'temml'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    // 界面上显示的版本号从 package.json 注入，避免发版时漏改硬编码（v0.5.1 前 App.tsx 写死 0.5.0）
    define: { __APP_VERSION__: JSON.stringify(version) },
    server: {
      // 强制 IPv4：新 Node 对 localhost 只监听 ::1，而 Electron/Chromium 请求 localhost
      // 走 127.0.0.1 → ERR_CONNECTION_REFUSED → dev 模式白屏
      host: '127.0.0.1',
      port: 5173
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
