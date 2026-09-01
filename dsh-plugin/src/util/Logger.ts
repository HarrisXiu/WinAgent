import { promises as fs, createWriteStream, WriteStream } from 'fs'
import path from 'path'
import { getDataDir } from '../config/ConfigStore'

class LoggerImpl {
  private stream: WriteStream | null = null
  private dir: string
  private day = ''

  constructor() {
    this.dir = path.join(getDataDir(), 'Logs')
  }

  private async ensure(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)
    if (this.stream && this.day === today) return
    await fs.mkdir(this.dir, { recursive: true })
    this.stream?.end()
    this.day = today
    this.stream = createWriteStream(path.join(this.dir, `agent_${today}.log`), { flags: 'a' })
  }

  private ts(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 23)
  }

  async write(level: string, msg: string): Promise<void> {
    try {
      await this.ensure()
      this.stream?.write(`[${this.ts()}] [${level}] ${msg}\n`)
    } catch {
      /* ignore logging failures */
    }
  }

  info(msg: string) {
    void this.write('INFO', msg)
  }
  error(msg: string) {
    void this.write('ERROR', msg)
  }
  // 脱敏后记录请求/响应
  section(title: string, body: string) {
    void this.write(title, '\n' + body + '\n' + '─'.repeat(80))
  }
}

export const Logger = new LoggerImpl()
