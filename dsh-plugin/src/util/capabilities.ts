/**
 * 本地能力探测：pandoc / LibreOffice / Office COM / pdfjs 渲染链 / PyMuPDF。
 * 结果进程内缓存；供 markdown_to_docx 引擎选择、office_convert 降级链与系统提示词能力注入共用。
 * 探测均为轻量子进程/注册表/文件检查，失败即视为能力不存在（不抛错）。
 * @module dsh-winagent/capabilities
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { PACKAGE_ROOT } from '../platform'
import { Logger } from './Logger'

export interface Capabilities {
  /** pandoc 版本号（外部增强引擎）；null = 未安装 */
  pandoc: string | null
  /** LibreOffice 版本号；null = 未安装 */
  soffice: string | null
  /** 可用的 soffice 命令（含常见安装绝对路径探测）；null = 未安装 */
  sofficeCmd: string | null
  /** Word COM 可用（装有 Office，注册表探测） */
  officeCom: boolean
  /** pdfjs-dist + @napi-rs/canvas 页面渲染链可用（render_pdf_page / extract_pdf_images） */
  pdfjsRender: boolean
  /** python + PyMuPDF 可用（可选增强） */
  pymupdf: boolean
}

const packageRequire = createRequire(path.join(PACKAGE_ROOT, 'package.json'))

function probeCmd(cmd: string, args: string[], timeout = 8000): string | null {
  try {
    const r = spawnSync(cmd, args, { timeout, encoding: 'utf8', windowsHide: true })
    if (r.status === 0) {
      return (((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/)[0] || '').slice(0, 120)
    }
    return null
  } catch {
    return null
  }
}

function probeOfficeCom(): boolean {
  // 注册表探测 Word.Application COM 注册（比启动 COM 快且无副作用）；非 Windows 恒 false
  if (process.platform !== 'win32') return false
  try {
    const r = spawnSync('reg', ['query', 'HKEY_CLASSES_ROOT\\Word.Application', '/ve'], {
      timeout: 5000,
      encoding: 'utf8',
      windowsHide: true
    })
    return r.status === 0
  } catch {
    return false
  }
}

/** 定位包安装目录（resolve 失败时按解析路径列表逐一探测，兼容 exports 字段限制） */
function packageDir(name: string): string | null {
  try {
    return path.dirname(packageRequire.resolve(`${name}/package.json`))
  } catch { /* exports 限制或未安装 */ }
  try {
    for (const p of packageRequire.resolve.paths(name) || []) {
      const d = path.join(p, name)
      if (fs.existsSync(path.join(d, 'package.json'))) return d
    }
  } catch { /* ignore */ }
  return null
}

function probePdfjsRender(): boolean {
  const pdfjsDir = packageDir('pdfjs-dist')
  if (!pdfjsDir) return false
  if (!fs.existsSync(path.join(pdfjsDir, 'legacy', 'build', 'pdf.mjs'))) return false
  try {
    packageRequire.resolve('@napi-rs/canvas')
    return true
  } catch {
    return false
  }
}

function probePymupdf(): boolean {
  // WindowsApps 存在 python stub 问题：先试 python，再试 py -3
  const importOk = (cmd: string, args: string[]): boolean => {
    try {
      const r = spawnSync(cmd, args, { timeout: 15000, encoding: 'utf8', windowsHide: true })
      return r.status === 0
    } catch {
      return false
    }
  }
  if (importOk('python', ['-c', 'import fitz'])) return true
  return importOk('py', ['-3', '-c', 'import fitz'])
}

function probeSoffice(): { version: string | null; cmd: string | null } {
  const candidates = [
    'soffice',
    'soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ]
  for (const c of candidates) {
    const v = probeCmd(c, ['--version'], 10000)
    if (v) return { version: v, cmd: c }
  }
  return { version: null, cmd: null }
}

let cached: Capabilities | null = null

/** 探测本地能力（进程内缓存；force=true 强制重探） */
export function getCapabilities(force = false): Capabilities {
  if (cached && !force) return cached
  const soffice = probeSoffice()
  cached = {
    pandoc: probeCmd('pandoc', ['--version']),
    soffice: soffice.version,
    sofficeCmd: soffice.cmd,
    officeCom: probeOfficeCom(),
    pdfjsRender: probePdfjsRender(),
    pymupdf: probePymupdf()
  }
  Logger.info(
    `[Capabilities] pandoc=${cached.pandoc ? '✓' : '✗'} soffice=${cached.soffice ? '✓' : '✗'} ` +
    `officeCom=${cached.officeCom ? '✓' : '✗'} pdfjsRender=${cached.pdfjsRender ? '✓' : '✗'} pymupdf=${cached.pymupdf ? '✓' : '✗'}`
  )
  return cached
}
