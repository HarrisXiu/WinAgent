import { promises as fs } from 'fs'
import path from 'path'
import type { Tool } from './types'
import { str, num, bool } from './types'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'out', '.next', '__pycache__'])

async function statSafe(p: string) {
  try {
    return await fs.stat(p)
  } catch {
    return null
  }
}

async function walkTree(dir: string, depth: number, maxDepth: number, entries: string[], maxEntries: number, prefix = ''): Promise<void> {
  if (depth > maxDepth || entries.length >= maxEntries) return
  let items: string[]
  try {
    items = await fs.readdir(dir)
  } catch {
    return
  }
  for (const name of items) {
    if (entries.length >= maxEntries) return
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const st = await statSafe(full)
    if (!st) continue
    if (st.isDirectory()) {
      entries.push(`${prefix}${name}/`)
      await walkTree(full, depth + 1, maxDepth, entries, maxEntries, prefix + '  ')
    } else {
      entries.push(`${prefix}${name}`)
    }
  }
}

export const fileTools: Tool[] = [
  {
    schema: {
      name: 'list_directory',
      description: '列出目录中的文件和子目录。recursive=true 时输出树形结构（默认跳过 .git/node_modules/bin/obj 等）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，例如 C:\\Users' },
          recursive: { type: 'boolean', description: '是否递归，默认 false' },
          max_depth: { type: 'integer', description: '递归最大深度，默认 5' },
          max_entries: { type: 'integer', description: '最大条目数，默认 500' }
        },
        required: ['path']
      }
    },
    async run(a) {
      const dir = str(a.path)
      if (bool(a.recursive)) {
        const entries: string[] = []
        await walkTree(dir, 1, num(a.max_depth, 5), entries, num(a.max_entries, 500))
        return entries.length ? entries.join('\n') : '（空目录）'
      }
      const items = await fs.readdir(dir)
      const lines: string[] = []
      for (const name of items) {
        const st = await statSafe(path.join(dir, name))
        if (!st) continue
        lines.push(st.isDirectory() ? `[DIR]  ${name}` : `       ${name}  (${st.size} B)`)
      }
      return lines.length ? lines.join('\n') : '（空目录）'
    }
  },
  {
    schema: {
      name: 'read_file',
      description: '读取文件内容。大文件用 offset/length 分步读取。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件完整路径' },
          offset: { type: 'integer', description: '起始字符偏移，默认 0' },
          length: { type: 'integer', description: '最多读取字符数，默认 20000' }
        },
        required: ['path']
      }
    },
    async run(a) {
      const content = await fs.readFile(str(a.path), 'utf-8')
      const offset = num(a.offset, 0)
      const length = num(a.length, 20000)
      const slice = content.slice(offset, offset + length)
      const more = offset + length < content.length ? `\n\n[已截断，下次 offset=${offset + length}]` : ''
      return slice + more
    }
  },
  {
    schema: {
      name: 'write_file',
      description: '创建或覆盖整个文件。仅用于新建文件或小文件；修改较大文件请用 edit_file。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件完整路径' },
          content: { type: 'string', description: '文件内容' },
          append: { type: 'boolean', description: '是否追加，默认 false' }
        },
        required: ['path', 'content']
      }
    },
    dangerous: true,
    async run(a) {
      const p = str(a.path)
      await fs.mkdir(path.dirname(p), { recursive: true })
      if (bool(a.append)) await fs.appendFile(p, str(a.content), 'utf-8')
      else await fs.writeFile(p, str(a.content), 'utf-8')
      return `已写入: ${p}`
    }
  },
  {
    schema: {
      name: 'edit_file',
      description: '精确字符串替换。old_string 必须字符级精确匹配且默认唯一，否则报错。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件完整路径' },
          old_string: { type: 'string', description: '要替换的原始字符串（唯一匹配）' },
          new_string: { type: 'string', description: '替换后的新字符串' },
          replace_all: { type: 'boolean', description: '替换全部，默认 false' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    },
    dangerous: true,
    async run(a) {
      const p = str(a.path)
      const content = await fs.readFile(p, 'utf-8')
      const oldStr = str(a.old_string)
      const newStr = str(a.new_string)
      if (bool(a.replace_all)) {
        const count = content.split(oldStr).length - 1
        if (count === 0) throw new Error('未找到匹配的 old_string')
        await fs.writeFile(p, content.split(oldStr).join(newStr), 'utf-8')
        return `已替换 ${count} 处: ${p}`
      }
      const first = content.indexOf(oldStr)
      if (first === -1) throw new Error('未找到匹配的 old_string')
      if (content.indexOf(oldStr, first + oldStr.length) !== -1)
        throw new Error('old_string 匹配多处，请扩展上下文使其唯一，或用 replace_all')
      await fs.writeFile(p, content.slice(0, first) + newStr + content.slice(first + oldStr.length), 'utf-8')
      return `已替换: ${p}`
    }
  },
  {
    schema: {
      name: 'multi_edit_file',
      description: '对单个文件批量精确替换，全部成功才写盘（失败回滚）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件完整路径' },
          edits: {
            type: 'array',
            description: 'edit 列表，每项含 old_string / new_string / 可选 replace_all',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string' },
                new_string: { type: 'string' },
                replace_all: { type: 'boolean' }
              },
              required: ['old_string', 'new_string']
            }
          }
        },
        required: ['path', 'edits']
      }
    },
    dangerous: true,
    async run(a) {
      const p = str(a.path)
      let content = await fs.readFile(p, 'utf-8')
      const edits = Array.isArray(a.edits) ? a.edits : []
      for (const [i, e] of edits.entries()) {
        const oldStr = str(e.old_string)
        const newStr = str(e.new_string)
        if (bool(e.replace_all)) {
          if (!content.includes(oldStr)) throw new Error(`edit[${i}] 未找到匹配`)
          content = content.split(oldStr).join(newStr)
        } else {
          const first = content.indexOf(oldStr)
          if (first === -1) throw new Error(`edit[${i}] 未找到匹配`)
          if (content.indexOf(oldStr, first + oldStr.length) !== -1) throw new Error(`edit[${i}] 匹配多处`)
          content = content.slice(0, first) + newStr + content.slice(first + oldStr.length)
        }
      }
      await fs.writeFile(p, content, 'utf-8')
      return `已应用 ${edits.length} 处编辑: ${p}`
    }
  },
  {
    schema: {
      name: 'delete_file',
      description: '删除文件或目录',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件或目录路径' },
          recursive: { type: 'boolean', description: '删除目录时是否递归，默认 false' }
        },
        required: ['path']
      }
    },
    dangerous: true,
    async run(a) {
      const p = str(a.path)
      const st = await statSafe(p)
      if (!st) throw new Error('路径不存在: ' + p)
      if (st.isDirectory()) await fs.rm(p, { recursive: bool(a.recursive), force: false })
      else await fs.unlink(p)
      return `已删除: ${p}`
    }
  },
  {
    schema: {
      name: 'copy_file',
      description: '复制文件',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '源文件路径' },
          destination: { type: 'string', description: '目标路径' },
          overwrite: { type: 'boolean', description: '是否覆盖，默认 false' }
        },
        required: ['source', 'destination']
      }
    },
    async run(a) {
      const src = str(a.source)
      const dst = str(a.destination)
      await fs.mkdir(path.dirname(dst), { recursive: true })
      await fs.copyFile(src, dst, bool(a.overwrite) ? 0 : fs.constants.COPYFILE_EXCL)
      return `已复制: ${src} → ${dst}`
    }
  },
  {
    schema: {
      name: 'move_file',
      description: '移动或重命名文件/目录',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '源路径' },
          destination: { type: 'string', description: '目标路径' }
        },
        required: ['source', 'destination']
      }
    },
    dangerous: true,
    async run(a) {
      const src = str(a.source)
      const dst = str(a.destination)
      await fs.mkdir(path.dirname(dst), { recursive: true })
      await fs.rename(src, dst)
      return `已移动: ${src} → ${dst}`
    }
  },
  {
    schema: {
      name: 'search_files',
      description: '在目录中按文件名模式搜索',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: '搜索目录' },
          pattern: { type: 'string', description: '文件名模式，如 *.pdf' },
          recursive: { type: 'boolean', description: '是否递归，默认 true' },
          max_results: { type: 'integer', description: '最多结果数，默认 50' }
        },
        required: ['directory', 'pattern']
      }
    },
    async run(a) {
      const dir = str(a.directory)
      const pattern = str(a.pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
      const re = new RegExp('^' + pattern + '$', 'i')
      const results: string[] = []
      const recursive = a.recursive === undefined ? true : bool(a.recursive)
      const max = num(a.max_results, 50)
      const st = await statSafe(dir)
      if (!st) return '目录不存在: ' + dir
      const walk = async (d: string): Promise<void> => {
        if (results.length >= max) return
        let items: string[]
        try {
          items = await fs.readdir(d)
        } catch {
          return
        }
        for (const name of items) {
          if (results.length >= max) return
          const full = path.join(d, name)
          const s = await statSafe(full)
          if (!s) continue
          if (s.isDirectory()) {
            if (recursive && !SKIP_DIRS.has(name)) await walk(full)
          } else if (re.test(name)) {
            results.push(full)
          }
        }
      }
      await walk(dir)
      return results.length ? results.join('\n') : '未找到匹配文件'
    }
  },
  {
    schema: {
      name: 'find_files',
      description: '在目录中查找文件（search_files 的别名）。按文件名模式搜索，支持通配符。',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: '搜索目录' },
          pattern: { type: 'string', description: '文件名模式，如 *.pdf 或 *.* 表示所有文件' },
          recursive: { type: 'boolean', description: '是否递归，默认 true' },
          max_results: { type: 'integer', description: '最多结果数，默认 50' }
        },
        required: ['directory', 'pattern']
      }
    },
    async run(a) {
      const dir = str(a.directory)
      const pattern = str(a.pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
      const re = new RegExp('^' + pattern + '$', 'i')
      const results: string[] = []
      const recursive = a.recursive === undefined ? true : bool(a.recursive)
      const max = num(a.max_results, 50)
      const st = await statSafe(dir)
      if (!st) return '目录不存在: ' + dir
      const walk = async (d: string): Promise<void> => {
        if (results.length >= max) return
        let items: string[]
        try {
          items = await fs.readdir(d)
        } catch {
          return
        }
        for (const name of items) {
          if (results.length >= max) return
          const full = path.join(d, name)
          const s = await statSafe(full)
          if (!s) continue
          if (s.isDirectory()) {
            if (recursive && !SKIP_DIRS.has(name)) await walk(full)
          } else if (re.test(name)) {
            results.push(full)
          }
        }
      }
      await walk(dir)
      return results.length ? results.join('\n') : '未找到匹配文件'
    }
  },
  {
    schema: {
      name: 'get_file_info',
      description: '获取文件或目录的详细信息',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件或目录路径' } },
        required: ['path']
      }
    },
    async run(a) {
      const p = str(a.path)
      const st = await statSafe(p)
      if (!st) return '路径不存在: ' + p
      if (st.isDirectory()) {
        const items = await fs.readdir(p)
        let files = 0
        let dirs = 0
        for (const name of items) {
          const s = await statSafe(path.join(p, name))
          if (s?.isDirectory()) dirs++
          else files++
        }
        return `目录: ${p}\n创建时间: ${st.birthtime.toLocaleString()}\n修改时间: ${st.mtime.toLocaleString()}\n文件数: ${files}\n子目录数: ${dirs}`
      }
      return `文件: ${p}\n大小: ${(st.size / 1024).toFixed(1)} KB\n创建时间: ${st.birthtime.toLocaleString()}\n修改时间: ${st.mtime.toLocaleString()}`
    }
  },
  {
    schema: {
      name: 'create_directory',
      description: '创建目录（含所有父目录）',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '要创建的目录路径' } },
        required: ['path']
      }
    },
    async run(a) {
      await fs.mkdir(str(a.path), { recursive: true })
      return `已创建目录: ${str(a.path)}`
    }
  },
  {
    schema: {
      name: 'grep',
      description: '在文件或目录内按正则搜索内容（类 ripgrep，默认跳过二进制与常见忽略目录）。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式（JS 语法）' },
          path: { type: 'string', description: '搜索起点（目录或文件）' },
          glob: { type: 'string', description: '文件名过滤，如 *.ts' },
          ignore_case: { type: 'boolean', description: '大小写不敏感，默认 false' },
          max_matches: { type: 'integer', description: '总匹配上限，默认 100' }
        },
        required: ['pattern', 'path']
      }
    },
    async run(a) {
      const re = new RegExp(str(a.pattern), bool(a.ignore_case) ? 'i' : '')
      const globRe = a.glob
        ? new RegExp('^' + str(a.glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
        : null
      const max = num(a.max_matches, 100)
      const out: string[] = []
      const searchFile = async (f: string): Promise<void> => {
        if (out.length >= max) return
        if (globRe && !globRe.test(path.basename(f))) return
        let text: string
        try {
          text = await fs.readFile(f, 'utf-8')
        } catch {
          return
        }
        if (text.includes('\u0000')) return // 二进制
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (out.length >= max) return
          if (re.test(lines[i])) out.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 300)}`)
        }
      }
      const st = await statSafe(str(a.path))
      if (!st) return '路径不存在'
      if (st.isFile()) await searchFile(str(a.path))
      else {
        const walk = async (d: string): Promise<void> => {
          if (out.length >= max) return
          let items: string[]
          try {
            items = await fs.readdir(d)
          } catch {
            return
          }
          for (const name of items) {
            if (out.length >= max) return
            if (SKIP_DIRS.has(name)) continue
            const full = path.join(d, name)
            const s = await statSafe(full)
            if (!s) continue
            if (s.isDirectory()) await walk(full)
            else await searchFile(full)
          }
        }
        await walk(str(a.path))
      }
      return out.length ? out.join('\n') : '无匹配'
    }
  }
]
