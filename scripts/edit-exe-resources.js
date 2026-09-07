/**
 * electron-builder afterPack hook + 独立 CLI 双模式。
 *
 * 背景：electron-builder 25.x 在打包后立即调用 rcedit 改写 exe 资源会因
 * Defender 实时扫描/文件句柄时序问题稳定失败（"Unable to commit changes"）。
 *
 * 模式 1（afterPack hook）：electron-builder.yml 中 afterPack: scripts/edit-exe-resources.js
 *   打包完成后主动触碰 exe（读→触碰时间戳），促使 Defender 完成扫描并释放句柄，
 *   使后续内置 rcedit 步骤能正常执行。
 *
 * 模式 2（独立 CLI）：npm run dist 流程末尾调用 node scripts/edit-exe-resources.js
 *   对 win-unpacked 主程序与 portable 产物执行带重试的 rcedit 资源写入，
 *   作为内置步骤失败时的兜底。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))

// productName 在 electron-builder.yml 中（避免引入 yml 解析依赖，用正则取值）
const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf-8')
const productName = (yml.match(/^productName:\s*(.+)$/m) || [])[1] || 'WinAgent'

// ─── 模式 1：afterPack hook ───
/** @param {import('electron-builder').AfterPackContext} context */
exports.afterPack = async function (context) {
  const exePath = path.join(context.appOutDir, 'WinAgent.exe')
  if (!fs.existsSync(exePath)) return
  for (let i = 0; i < 5; i++) {
    try {
      const fd = fs.openSync(exePath, 'r+')
      fs.closeSync(fd)
      const now = Date.now() / 1000
      fs.utimesSync(exePath, now, now)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

// ─── 模式 2：独立 CLI ───
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

if (require.main === module) {
  try {
    main()
  } catch (err) {
    console.error('exe 资源写入失败:', err.message)
    process.exit(1)
  }
}
