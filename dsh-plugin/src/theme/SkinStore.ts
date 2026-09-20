/**
 * 主题包（外观皮肤）库：用户上传的 gif/png/jpg/webp 素材存储与元数据管理。
 * 素材复制到 {dataDir}/skins/<id>/<slot>.<ext>，元数据存 skins/skins.json。
 *
 * 槽位可缺省：只传 idle 也能用，渲染层其余状态回退到 idle（降低制作门槛）。
 * 主进程经 winagent-skin://<skinId>/<slot> 自定义协议把素材送达渲染层（带 ?v=mtime 缓存失效）。
 */
import { promises as fs } from 'fs'
import path from 'path'
import type { SkinMeta, SkinSlot } from '../shared/types'

/** 单个素材文件大小上限 */
const MAX_SKIN_FILE = 5 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

export const SKIN_SLOTS: SkinSlot[] = ['idle', 'think', 'tool', 'vision', 'talk', 'avatar']

export class SkinStore {
  private dir: string
  private metaPath: string

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'skins')
    this.metaPath = path.join(this.dir, 'skins.json')
  }

  private async loadMeta(): Promise<SkinMeta[]> {
    try {
      const raw = await fs.readFile(this.metaPath, 'utf-8')
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }

  private async saveMeta(list: SkinMeta[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this.metaPath, JSON.stringify(list, null, 2), 'utf-8')
  }

  async list(): Promise<SkinMeta[]> {
    return this.loadMeta()
  }

  /** 新建空主题包（素材随后逐槽位上传） */
  async create(name: string): Promise<SkinMeta> {
    const meta: SkinMeta = {
      id: `sk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: (name || '').trim().slice(0, 30) || '未命名主题包',
      slots: {},
      createdAt: new Date().toISOString()
    }
    const list = await this.loadMeta()
    list.unshift(meta)
    await this.saveMeta(list)
    return meta
  }

  private async requireMeta(id: string): Promise<SkinMeta> {
    const meta = (await this.loadMeta()).find((m) => m.id === id)
    if (!meta) throw new Error(`主题包不存在: ${id}`)
    return meta
  }

  /** 写回单个主题包的元数据 */
  private async patchMeta(meta: SkinMeta): Promise<void> {
    const list = await this.loadMeta()
    const idx = list.findIndex((m) => m.id === meta.id)
    if (idx >= 0) list[idx] = meta
    await this.saveMeta(list)
  }

  /** 上传槽位素材：校验格式与大小后复制进 <id>/<slot>.<ext>（替换旧扩展名文件） */
  async setSlot(id: string, slot: SkinSlot, srcPath: string): Promise<SkinMeta> {
    if (!SKIN_SLOTS.includes(slot)) throw new Error(`未知的槽位: ${slot}`)
    const meta = await this.requireMeta(id)
    const ext = path.extname(srcPath).toLowerCase()
    const mime = MIME_BY_EXT[ext]
    if (!mime) throw new Error('仅支持 png / gif / jpg / webp 格式的图片')
    const buf = await fs.readFile(srcPath)
    if (buf.length > MAX_SKIN_FILE) {
      throw new Error(`图片过大（约 ${(buf.length / 1024 / 1024).toFixed(1)}MB），请控制在 5MB 以内`)
    }
    const skinDir = path.join(this.dir, id)
    await fs.mkdir(skinDir, { recursive: true })
    // 旧文件扩展名可能不同，先清掉同槽位旧文件
    const entries = await fs.readdir(skinDir).catch(() => [] as string[])
    for (const f of entries) {
      if (f.startsWith(`${slot}.`)) await fs.rm(path.join(skinDir, f), { force: true }).catch(() => {})
    }
    const file = `${slot}${ext}`
    await fs.writeFile(path.join(skinDir, file), buf)
    const st = await fs.stat(path.join(skinDir, file))
    meta.slots[slot] = { file, mtime: Math.round(st.mtimeMs) }
    await this.patchMeta(meta)
    return meta
  }

  /** 清空槽位（素材缺失不报错） */
  async clearSlot(id: string, slot: SkinSlot): Promise<SkinMeta> {
    const meta = await this.requireMeta(id)
    const file = meta.slots[slot]?.file
    if (file) await fs.rm(path.join(this.dir, id, file), { force: true }).catch(() => {})
    delete meta.slots[slot]
    await this.patchMeta(meta)
    return meta
  }

  /** 删除主题包（整个目录 + 元数据） */
  async remove(id: string): Promise<void> {
    const list = await this.loadMeta()
    if (!list.some((m) => m.id === id)) return
    await fs.rm(path.join(this.dir, id), { recursive: true, force: true }).catch(() => {})
    await this.saveMeta(list.filter((m) => m.id !== id))
  }

  /** 重命名主题包 */
  async rename(id: string, name: string): Promise<SkinMeta[]> {
    const meta = await this.requireMeta(id)
    const next = (name || '').trim().slice(0, 30)
    if (next) meta.name = next
    await this.patchMeta(meta)
    return this.loadMeta()
  }

  /** 解析槽位文件的绝对路径（协议处理器用；不存在返回 null） */
  resolveSlotFile(id: string, slot: SkinSlot, file: string): string | null {
    if (!SKIN_SLOTS.includes(slot)) return null
    const safe = path.basename(file)
    return path.join(this.dir, path.basename(id), safe)
  }
}
