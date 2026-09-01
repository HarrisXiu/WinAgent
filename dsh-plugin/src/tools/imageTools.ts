import type { Tool } from './types'
import { str } from './types'

/** 常见风格 → 绘图关键词映射（英文，兼容主流生成工具） */
const STYLE_KEYWORDS: Record<string, string> = {
  写实: 'photorealistic, high detail, 8k',
  照片: 'photorealistic, shot on DSLR, 50mm lens, shallow depth of field',
  动漫: 'anime style, cel shading, vibrant colors',
  二次元: 'anime style, Japanese illustration, clean lineart',
  赛博朋克: 'cyberpunk, neon lights, futuristic city',
  水彩: 'watercolor painting, soft edges, textured paper',
  油画: 'oil painting, thick brushstrokes, classic art style',
  素描: 'pencil sketch, graphite, monochrome',
  '3D': '3D render, octane render, soft global illumination',
  pixar: 'Pixar style, cute 3D render, soft lighting',
  像素: 'pixel art, 8-bit style, retro game graphics',
  极简: 'minimalist, clean composition, negative space',
  国风: 'Chinese ink painting, traditional style, elegant',
  科幻: 'sci-fi, futuristic, cinematic lighting',
  梦幻: 'dreamy, ethereal, soft pastel colors, glowing atmosphere',
  可爱: 'cute, kawaii, soft colors, adorable'
}

const RATIO_PARAM: Record<string, string> = {
  '1:1': '--ar 1:1',
  '4:3': '--ar 4:3',
  '3:4': '--ar 3:4',
  '16:9': '--ar 16:9',
  '9:16': '--ar 9:16',
  '21:9': '--ar 21:9'
}

export const imageTools: Tool[] = [
  {
    schema: {
      name: 'generate_image_prompt',
      description:
        '为图像生成工具（Midjourney / Stable Diffusion / 即梦AI / DALL·E 等）生成可直接复制使用的绘图提示词（Prompt）。' +
        '当用户需要图片、照片、插画、头像、海报等视觉内容，或任务需要配图时调用。' +
        '返回内容包含：英文 Prompt（可直接粘贴）、中文拆解说明（主体/场景/风格/光线/构图）、适用工具建议。',
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: '图片需求描述，如：一只戴围巾的橘猫坐在雪地里' },
          style: {
            type: 'string',
            description:
              '期望风格（可选）：写实/照片/动漫/二次元/赛博朋克/水彩/油画/素描/3D/pixar/像素/极简/国风/科幻/梦幻/可爱'
          },
          aspect_ratio: { type: 'string', description: '宽高比（可选）：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9' }
        },
        required: ['request']
      }
    },
    async run(a) {
      const request = str(a.request).trim()
      if (!request) throw new Error('request 不能为空')

      const style = str(a.style).trim()
      const styleKw = STYLE_KEYWORDS[style] || STYLE_KEYWORDS['写实']
      const ratio = RATIO_PARAM[str(a.aspect_ratio).trim()] || RATIO_PARAM['1:1']
      const styleLabel = style || '写实照片'

      const enPrompt = `${request}, ${styleKw}, professional composition, ${ratio}`

      return [
        `【图片生成提示词】`,
        ``,
        `📋 可直接复制的 Prompt（英文，复制到 Midjourney / Stable Diffusion / 即梦AI 等工具）：`,
        `\`\`\``,
        `${enPrompt}`,
        `\`\`\``,
        ``,
        `📖 中文拆解（如需要可自行调整）：`,
        `- 主体：${request}`,
        `- 风格：${styleLabel}（${styleKw}）`,
        `- 构图：专业构图，主体居中偏三分线`,
        `- 比例：${str(a.aspect_ratio).trim() || '1:1'}（${ratio}）`,
        ``,
        `💡 使用建议：`,
        `- Midjourney：直接粘贴 Prompt，后缀参数已含宽高比；`,
        `- Stable Diffusion：把 Prompt 粘贴到正向提示词框，负面提示词建议加 lowres, blurry, bad anatomy, watermark；`,
        `- 即梦AI / 其他国产工具：粘贴后选择相应风格与比例即可。`,
        ``,
        `如对风格/比例不满意，告诉我想要的感觉，我可以重新生成。`
      ].join('\n')
    }
  }
]
