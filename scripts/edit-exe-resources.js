/**
 * 打包后为 exe 写入图标与版本资源（替代 electron-builder 内置 rcedit 步骤）。
 *
 * 背景：electron-builder 25.x 在打包后立即调用 rcedit 会因文件句柄时序问题
 * 稳定失败（"Fatal error: Unable to commit changes"），而稍后手动执行同一命令
 * 必然成功。因此关闭 win.signAndEditExecutable，在打包完成后由本脚本带重试地
 * 对 win-unpacked 主程序与 portable 产物执行资源写入。
 *
 * 用法: node scripts/edit-exe-resources.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))

// productName 在 electron-builder.yml 中（避免引入 yml 解析依赖，用正则取值）
const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf-8')
const productName = (yml.match(/^productName:\s*(.+)$/m) || [])[1] || 'WinAgent'

// 定位 electron-builder 缓存中的 rcedit-x64.exe（取版本号最大的 winCodeSign-* 目录）
function resolveRedit() {
  const cacheDir = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign')
  if (!fs.existsSync(cacheDir)) throw new Error(`未找到 winCodeSign 缓存目录: ${cacheDir}`)
  const dirs = fs
    .readdirSync(cacheDir)
    .filter((d) => d.startsWith('winCodeSign-'))
    .sort()
    .reverse()
  for (const d of dirs) {
    const exe = path.join(cacheDir, d, 'rcedit-x64.exe')
    if (fs.existsSync(exe)) return exe
  }
  throw new Error('未找到 rcedit-x64.exe')
}

function editExe(rcedit, exe) {
  const args = [
    exe,
    '--set-version-string', 'FileDescription', pkg.description || productName,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'LegalCopyright', `Copyright © ${new Date().getFullYear()} ${productName}`,
    '--set-file-version', pkg.version,
    '--set-product-version', `${pkg.version}.0`,
    '--set-version-string', 'InternalName', productName,
    '--set-version-string', 'OriginalFilename', `${productName}.exe`,
    '--set-version-string', 'CompanyName', productName,
    '--set-icon', path.join(ROOT, 'build', 'icon.ico'),
  ]
  // 打包刚结束时 exe 可能被 Defender 扫描/句柄未释放短暂锁住，带重试
  const MAX = 6
  for (let i = 1; i <= MAX; i++) {
    try {
      execFileSync(rcedit, args, { stdio: 'pipe' })
      console.log(`已写入资源: ${exe}`)
      return
    } catch (err) {
      console.warn(`第 ${i}/${MAX} 次写入失败: ${path.basename(exe)} (${String(err.status)})`)
      if (i === MAX) throw err
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},4000)'])
    }
  }
}

function main() {
  const rcedit = resolveRedit()
  console.log(`rcedit: ${rcedit}`)
  const targets = [path.join(ROOT, 'release', 'win-unpacked', `${productName}.exe`)]
  const portable = path.join(ROOT, 'release', `WinAgent-${pkg.version}-win64.exe`)
  if (fs.existsSync(portable)) targets.push(portable)
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      console.warn(`跳过（不存在）: ${t}`)
      continue
    }
    editExe(rcedit, t)
  }
}

try {
  main()
} catch (err) {
  console.error('exe 资源写入失败:', err.message)
  process.exit(1)
}
