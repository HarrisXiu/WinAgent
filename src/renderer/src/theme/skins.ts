/**
 * 主题包解析：把配置里的 skin id（plain / angelina / custom:<id>）解析成渲染层可用的
 * ResolvedSkin（立绘、头像、装饰、文案）。安洁莉娜素材经动态 import 代码分割——
 * 普通主题用户不为其 5.5MB 的 GIF 买单。
 */
import type { SkinMeta, SkinSlot } from '../../../shared/types'

/** Agent 实时状态：空闲 / 思考 / 执行工具 / 图片识别 / 回答中 */
export type AiState = 'idle' | 'think' | 'tool' | 'vision' | 'talk'

export interface ResolvedSkin {
  id: string
  /** 角色名；plain 为 null（不显示名字栏） */
  name: string | null
  /** 五态立绘 URL；plain 为 null（走无吉祥物分支） */
  art: Record<AiState, string> | null
  avatar: string | null
  /** 漂浮装饰；仅内置 angelina 有，自定义包不开放该槽位 */
  decorations: { bubble: string; heart: string; cloud: string; wand: string } | null
  stateLabel: Record<AiState, string>
  stateText: Record<AiState, string>
  /** 首屏欢迎语 / 输入框 placeholder（按主题包取值） */
  welcome: string
  placeholder: string
}

/** 普通主题（默认）：无吉祥物、文案中性 */
export const PLAIN_SKIN: ResolvedSkin = {
  id: 'plain',
  name: null,
  art: null,
  avatar: null,
  decorations: null,
  stateLabel: {
    idle: '待命中',
    think: '思考中',
    tool: '执行工具中',
    vision: '识别图片中',
    talk: '回答中'
  },
  stateText: {
    idle: '',
    think: '正在思考…',
    tool: '正在执行工具…',
    vision: '正在识别图片…',
    talk: '正在回答…'
  },
  welcome: '你的 Windows 智能助手：聊天问答、文件整理、系统自动化与个人知识库，一站式完成。',
  placeholder: '输入任务或问题，交给助手处理…'
}

const NEUTRAL_TEXT = { ...PLAIN_SKIN.stateText }

/** 安洁莉娜素材模块的动态加载（Vite 代码分割，GIF 不进主 chunk） */
export async function resolveAngelinaSkin(): Promise<ResolvedSkin> {
  const m = await import('./skins/angelina')
  return {
    id: 'angelina',
    name: 'Angelina',
    art: m.ANGELINA_ART,
    avatar: m.ANGELINA_AVATAR,
    decorations: m.ANGELINA_DECOR,
    stateLabel: PLAIN_SKIN.stateLabel,
    stateText: {
      idle: '',
      think: 'Angelina 正在思考…',
      tool: 'Angelina 正在执行工具…',
      vision: 'Angelina 正在识别图片…',
      talk: 'Angelina 正在回答…'
    },
    welcome:
      '安洁莉娜的陪伴空间~ 来自罗德岛的信使陪你聊天，也能替你跑腿处理电脑上的全部杂活（完整 Windows 工具集 + 知识库）。',
    placeholder: '和安洁莉娜聊聊天，或者让她帮你跑跑腿…'
  }
}

/** 自定义主题包：立绘缺省槽位回退到 idle，状态文案保持中性 */
export function resolveCustomSkin(meta: SkinMeta): ResolvedSkin {
  const url = (slot: SkinSlot): string | null => {
    const f = meta.slots[slot]
    return f ? `winagent-skin://${meta.id}/${slot}?v=${f.mtime}` : null
  }
  const idle = url('idle')
  const art = idle
    ? {
        idle,
        think: url('think') ?? idle,
        tool: url('tool') ?? idle,
        vision: url('vision') ?? idle,
        talk: url('talk') ?? idle
      }
    : null
  return {
    id: `custom:${meta.id}`,
    name: meta.name,
    art,
    avatar: url('avatar'),
    decorations: null,
    stateLabel: PLAIN_SKIN.stateLabel,
    stateText: NEUTRAL_TEXT,
    welcome: PLAIN_SKIN.welcome,
    placeholder: PLAIN_SKIN.placeholder
  }
}

/**
 * 同步解析皮肤（angelina 需异步加载素材，由 SkinProvider 特判 await）。
 * 自定义包已被删除时回退到普通主题，绝不空白。
 */
export function resolveSkin(skinId: string, customList: SkinMeta[]): ResolvedSkin {
  if (skinId.startsWith('custom:')) {
    const meta = customList.find((m) => m.id === skinId.slice('custom:'.length))
    return meta ? resolveCustomSkin(meta) : PLAIN_SKIN
  }
  // 'angelina'（异步由 SkinProvider 处理）与未知值都先回落普通主题
  return PLAIN_SKIN
}
