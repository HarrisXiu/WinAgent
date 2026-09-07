/**
 * 将源 PNG 图标转换为多分辨率 ICO 文件。
 * 用法: node scripts/build-icon.js [source.png] [output.ico]
 * 默认: Angelina/PNG/送货.png → build/icon.ico
 *
 * 注：使用 png2icons 生成 —— 小尺寸用 BMP(DIB) 编码、仅 256×256 用 PNG，
 * rcedit（electron-builder 打包时改写 exe 资源）不接受全 PNG 编码的 ICO。
 */
const fs = require('fs')
const path = require('path')

const SRC = process.argv[2] || path.join(__dirname, '..', 'Angelina', 'PNG', '送货.png')
const DST = process.argv[3] || path.join(__dirname, '..', 'build', 'icon.ico')

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`源文件不存在: ${SRC}`)
    process.exit(1)
  }

  const png2icons = require('png2icons')
  console.log(`源文件: ${SRC}`)

  // 源图需为 ≥256×256 的正方形 PNG；png2icons 缩出全套尺寸（小尺寸 BMP 编码，仅 256 用 PNG）
  const icoBuf = png2icons.createICO(fs.readFileSync(SRC), png2icons.BICUBIC2, 0, false, true)
  if (!icoBuf) {
    console.error('ICO 生成失败')
    process.exit(1)
  }

  const outDir = path.dirname(DST)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(DST, icoBuf)
  console.log(`已生成: ${DST} (${(icoBuf.length / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  console.error('图标生成失败:', err)
  process.exit(1)
})
