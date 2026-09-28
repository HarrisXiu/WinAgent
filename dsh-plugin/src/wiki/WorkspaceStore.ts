import { promises as fs } from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import type { KnowledgeSource, SourceChunk, WikiJob, RuleSet, TaskRuleReport } from '../shared/types'

export const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

/** Lossless splitting: every character belongs to a chunk; anchors refer to extracted text lines. */
export function splitSource(text: string, budget = 5500): SourceChunk[] {
  if (budget < 100) throw new Error('分块预算过小')
  const chunks: SourceChunk[] = []
  let offset = 0, line = 1
  while (offset < text.length) {
    let end = Math.min(offset + budget, text.length)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1)
      if (newline > offset + budget / 2) end = newline + 1
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--
    }
    const body = text.slice(offset, end)
    const lineEnd = line + (body.match(/\n/g) || []).length
    chunks.push({ id: `part-${chunks.length + 1}`, text: body, lineStart: line, lineEnd })
    offset = end; line = lineEnd
  }
  return chunks
}

/** One atomic file per record, in the vault so backups and vault switching include state. */
export class WorkspaceStore {
  constructor(private root: () => string) {}
  private file(kind: string, id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('无效记录标识')
    return path.join(this.root(), '.winagent', kind, `${id}.json`)
  }
  async read<T>(kind: string, id: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(this.file(kind, id), 'utf8')) as T }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
  async write<T>(kind: string, id: string, value: T): Promise<void> {
    const file = this.file(kind, id)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(tmp, file)
  }
  async remove(kind: string, id: string): Promise<void> {
    await fs.rm(this.file(kind, id), { force: true })
  }
  async list<T>(kind: string): Promise<T[]> {
    const dir = path.dirname(this.file(kind, 'record'))
    let names: string[]
    try { names = await fs.readdir(dir) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    const records: T[] = []
    for (const name of names.filter(n => n.endsWith('.json'))) {
      const value = await this.read<T>(kind, name.slice(0, -5))
      if (value) records.push(value)
    }
    return records
  }
  sources(): Promise<KnowledgeSource[]> { return this.list('sources') }
  rules(): Promise<RuleSet[]> { return this.list('rules') }
  jobs(): Promise<WikiJob[]> { return this.list('jobs') }
  async recover(): Promise<void> {
    for (const job of await this.jobs()) if (job.status === 'running') {
      await this.write('jobs', job.id, { ...job, status: 'interrupted', error: '上次处理已中断，重试将复用已完成的分析。', updated: new Date().toISOString() })
    }
  }
  saveReport(report: TaskRuleReport): Promise<void> { return this.write('tasks', report.id, report) }
}
