/**
 * 安洁莉娜内置特殊主题的素材清单（版权素材，仅作可选主题随应用分发）。
 * 经 App 的动态 import 使用：Vite 会把本模块与 GIF 拆成独立 chunk。
 * talk 态使用专属的纸飞机动图（信使送信），不再复用 idle 的坐坐。
 */
import zuozuoGif from '../../assets/angelina/zuozuo.gif'
import kanshuGif from '../../assets/angelina/kanshu.gif'
import tanxianGif from '../../assets/angelina/tanxian.gif'
import paizhaoGif from '../../assets/angelina/paizhao.gif'
import zhifeijiGif from '../../assets/angelina/zhifeiji.gif'
import avatarImg from '../../assets/angelina/avatar.png'
import cloudImg from '../../assets/angelina/cloud.png'
import wandImg from '../../assets/angelina/wand.png'
import bubbleImg from '../../assets/angelina/bubble.png'
import heartImg from '../../assets/angelina/heart.png'
import type { AiState } from '../skins'

export const ANGELINA_ART: Record<AiState, string> = {
  idle: zuozuoGif,
  think: kanshuGif,
  tool: tanxianGif,
  vision: paizhaoGif,
  talk: zhifeijiGif
}

export const ANGELINA_AVATAR = avatarImg

export const ANGELINA_DECOR = {
  bubble: bubbleImg,
  heart: heartImg,
  cloud: cloudImg,
  wand: wandImg
}
