import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { SavedConversation, ConversationSummary } from '../shared/types'

export class ConversationStore {
  constructor(private root: string) {}
  private file(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('无效任务 ID')
    return path.join(this.root, `${id}.json`)
  }
  async list(): Promise<ConversationSummary[]> {
    await fs.mkdir(this.root, { recursive: true })
    const files = (await fs.readdir(this.root)).filter(f => f.endsWith('.json'))
    const records = await Promise.all(files.map(f => this.read(f.slice(0,-5))))
    return records.map(({id,title,updated,kind,topicTag})=>({id,title,updated,kind,topicTag})).sort((a,b)=>b.updated.localeCompare(a.updated))
  }
  async read(id: string): Promise<SavedConversation> { return JSON.parse(await fs.readFile(this.file(id), 'utf8')) }
  async write(record: SavedConversation): Promise<void> {
    const file = this.file(record.id)
    await fs.mkdir(this.root, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(record), 'utf8'); await fs.rename(temporary, file)
  }
}
