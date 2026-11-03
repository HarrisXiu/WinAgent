/**
 * 生成 portable exe 解压阶段的启动图 build/splash.bmp（electron-builder portable.splashImage）。
 *
 * 用法：npm run build:splash（dist/pack 会自动先跑）
 * 以 Electron 离屏渲染 src/main/splash.html 的 static 模式（与运行时启动窗同一份模板，
 * 版本号取 package.json），输出 24 位 BMP——NSIS 启动图只认不带透明通道的位图。
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'build', 'splash.bmp')
const WIDTH = 340
const HEIGHT = 240

const { version } = require(path.join(ROOT, 'package.json'))
// 与 src/main/splash.ts 的 renderSplashHtml 同规则；解压图固定浅色 + 默认粉蓝
const html = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'splash.html'), 'utf-8')
  .replace(/__THEME__/g, 'light')
  .replace(/__ACCENT__/g, '#f4719c')
  .replace(/__ACCENT2__/g, '#6db7d9')
  .replace(/__SCHEME__/g, 'classic')
  .replace(/__VERSION__/g, version)
  .replace(/__MODE__/g, 'static')

/** BGRA 原始像素 → 24 位自底向上 BMP（行按 4 字节对齐） */
function toBmp(bgra, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowSize * height
  const buf = Buffer.alloc(54 + pixelBytes)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(54 + pixelBytes, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30)
  buf.writeUInt32LE(pixelBytes, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = 54 + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      buf[dst + x * 3] = bgra[src + x * 4]
      buf[dst + x * 3 + 1] = bgra[src + x * 4 + 1]
      buf[dst + x * 3 + 2] = bgra[src + x * 4 + 2]
    }
  }
  return buf
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { offscreen: true }
  })
  let frame = null
  win.webContents.on('paint', (_e, _dirty, image) => {
    frame = image
  })
  win.webContents.setFrameRate(30)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // 等字体与首帧稳定
  await new Promise((r) => setTimeout(r, 800))
  if (!frame) {
    console.error('build-splash: 未捕获到渲染帧')
    app.exit(1)
    return
  }
  let image = frame
  const size = image.getSize()
  if (size.width !== WIDTH || size.height !== HEIGHT) image = image.resize({ width: WIDTH, height: HEIGHT, quality: 'best' })
  fs.writeFileSync(OUT, toBmp(image.toBitmap(), WIDTH, HEIGHT))
  console.log(`build-splash: 已生成 ${path.relative(ROOT, OUT)}（${WIDTH}×${HEIGHT}，v${version}）`)
  app.exit(0)
})
