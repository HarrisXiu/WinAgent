/**
 * 将源 PNG 图标转换为多分辨率 ICO 文件。
 * 用法: node scripts/build-icon.js [source.png] [output.ico]
 * 默认: Angelina/PNG/送货.png → build/icon.ico
 */
const fs = require('fs')
const path = require('path')

const SRC = process.argv[2] || path.join(__dirname, '..', 'Angelina', 'PNG', '送货.png')
const DST = process.argv[3] || path.join(__dirname, '..', 'build', 'icon.ico')
// ICO 标准尺寸（支持 PNG 编码）
const SIZES = [256, 128, 64, 48, 32, 16]

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`源文件不存在: ${SRC}`)
    process.exit(1)
  }

  // 动态导入 ESM 模块
  const { Jimp } = await import('jimp')
  const pngToIco = (await import('png-to-ico')).default || (await import('png-to-ico'))

  console.log(`源文件: ${SRC}`)
  const srcImg = await Jimp.read(SRC)
  console.log(`原始尺寸: ${srcImg.width}×${srcImg.height}`)

  // 缩放为多个尺寸并导出为 PNG buffer
  const pngs = await Promise.all(
    SIZES.map(async (size) => {
      const img = srcImg.clone().resize({ w: size, h: size })
      const buf = await img.getBuffer('image/png')
      console.log(`  生成 ${size}×${size} PNG (${(buf.length / 1024).toFixed(1)} KB)`)
      return buf
    })
  )

  // 打包为 ICO
  const icoBuf = await pngToIco(pngs)
  const outDir = path.dirname(DST)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(DST, icoBuf)
  console.log(`已生成: ${DST} (${(icoBuf.length / 1024).toFixed(1)} KB)`)
  console.log(`包含尺寸: ${SIZES.map((s) => `${s}×${s}`).join(', ')}`)
}

main().catch((err) => {
  console.error('图标生成失败:', err)
  process.exit(1)
})
