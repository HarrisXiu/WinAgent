import { promises as fs } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import type { Tool } from '../tools/types'
import { Logger } from '../util/Logger'

interface SkillManifest {
  name: string
  description: string
  parameters?: { type: 'object'; properties: Record<string, any>; required?: string[] }
  runtime?: 'node' | 'python' | 'command'
  entry: string
  dangerous?: boolean
}

function runtimeCmd(runtime: string, entry: string): { cmd: string; args: string[] } {
  switch (runtime) {
    case 'python':
      return { cmd: 'python', args: [entry] }
    case 'command':
      return { cmd: 'cmd.exe', args: ['/c', entry] }
    case 'node':
    default:
      return { cmd: process.execPath, args: [entry] }
  }
}

function execSkill(dir: string, manifest: SkillManifest, args: Record<string, any>): Promise<string> {
  return new Promise((resolve, reject) => {
    const entry = path.join(dir, manifest.entry)
    const { cmd, args: baseArgs } = runtimeCmd(manifest.runtime || 'node', entry)
    // node 运行时禁用 Electron 特有行为
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    const proc = spawn(cmd, baseArgs, { cwd: dir, env, windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim() || '(skill 无输出)')
      else reject(new Error(err.trim() || `skill 退出码 ${code}`))
    })
    proc.on('error', (e) => reject(e))
    // 参数以 JSON 从 stdin 传入
    proc.stdin.write(JSON.stringify(args))
    proc.stdin.end()
  })
}

export async function loadSkills(skillsDir: string): Promise<Tool[]> {
  const tools: Tool[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(skillsDir)
  } catch {
    return tools
  }
  for (const name of entries) {
    const dir = path.join(skillsDir, name)
    const manifestPath = path.join(dir, 'manifest.json')
    try {
      const st = await fs.stat(dir)
      if (!st.isDirectory()) continue
      const manifest: SkillManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
      if (!manifest.name || !manifest.entry) continue
      tools.push({
        schema: {
          name: manifest.name,
          description: `[skill] ${manifest.description || manifest.name}`,
          parameters: manifest.parameters || { type: 'object', properties: {}, required: [] }
        },
        dangerous: manifest.dangerous,
        run: (args) => execSkill(dir, manifest, args)
      })
      Logger.info(`[Skill] 已加载: ${manifest.name}`)
    } catch (e) {
      Logger.error(`[Skill] 加载失败 ${name}: ${String(e)}`)
    }
  }
  return tools
}
