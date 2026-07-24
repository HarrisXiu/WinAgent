import { promises as fs } from 'fs'
import path from 'path'
import type { Tool } from './types'
import { str, bool } from './types'

export const httpTools: Tool[] = [
  {
    schema: {
      name: 'http_request',
      description: '发起 HTTP 请求（GET/POST/PUT/DELETE 等），返回响应文本',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '请求 URL' },
          method: { type: 'string', description: 'GET(默认)/POST/PUT/DELETE/PATCH' },
          body: { type: 'string', description: '请求体（POST/PUT 时）' },
          content_type: { type: 'string', description: 'Content-Type' },
          headers: { type: 'string', description: '额外请求头 JSON 字符串' }
        },
        required: ['url']
      }
    },
    async run(a) {
      const method = str(a.method, 'GET').toUpperCase()
      const headers: Record<string, string> = {}
      if (a.content_type) headers['Content-Type'] = str(a.content_type)
      if (a.headers) {
        try {
          Object.assign(headers, JSON.parse(str(a.headers)))
        } catch {
          /* ignore */
        }
      }
      const res = await fetch(str(a.url), {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : str(a.body)
      })
      const text = await res.text()
      return `HTTP ${res.status}\n${text.slice(0, 20000)}`
    }
  },
  {
    schema: {
      name: 'http_download',
      description: '下载 URL 到本地文件',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '下载 URL' },
          save_path: { type: 'string', description: '本地保存路径' },
          body: { type: 'string', description: 'POST 请求体（可选，有值则用 POST）' }
        },
        required: ['url', 'save_path']
      }
    },
    async run(a) {
      const res = await fetch(str(a.url), {
        method: a.body ? 'POST' : 'GET',
        body: a.body ? str(a.body) : undefined
      })
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const out = str(a.save_path)
      await fs.mkdir(path.dirname(out), { recursive: true })
      await fs.writeFile(out, buf)
      return `已下载 ${buf.length} 字节到: ${out}`
    }
  }
]
