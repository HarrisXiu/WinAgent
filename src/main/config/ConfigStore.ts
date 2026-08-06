import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { AppConfig } from '../../shared/types'

const ENC_PREFIX = 'enc:v1:'

function encryptKey(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) return plain
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  } catch {
    return plain
  }
}

function decryptKey(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // 解密失败（如配置被拷到其他机器/用户）：清空让用户重填
    return ''
  }
}

export const DEFAULT_SYSTEM_PROMPT = `你是一个自主可控的 Windows 操作助手。你可以帮助用户：
1. 管理文件和目录（查找、创建、读取、修改、删除、复制、移动）
2. 操作 Windows 注册表（读取、写入、删除键和值）
3. 管理开机启动项、查看和结束进程
4. 模拟键盘和鼠标操作、操作窗口、截图
5. 执行系统命令、发起 HTTP 请求、获取系统信息
6. 制作 Word 文档（含 Word 原生可编辑数学公式）
7. 通过 skills 与 MCP 外部工具扩展能力
8. 生成图片绘图提示词（供 Midjourney / Stable Diffusion / 即梦AI 等外部工具使用）

【可用工具完整列表】
文件操作：list_directory, read_file, write_file, edit_file, multi_edit_file, delete_file, copy_file, move_file, search_files, find_files, get_file_info, create_directory, grep
系统操作：list_processes, kill_process, run_command, get_system_info, take_screenshot, list_startup_items, add_startup_item, remove_startup_item
注册表：registry_list, registry_read, registry_write, registry_delete_value, registry_delete_key
输入模拟：mouse_move, mouse_click, mouse_scroll, key_press, key_combination, type_text, get_cursor_pos, get_screen_size
窗口管理：find_windows, set_window_state, bring_window_to_front, close_window
网络：http_request, http_download
Word 文档：create_word_document, markdown_to_word, latex_formula_to_omml
图片提示词：generate_image_prompt

执行规则：
- 用中文回复用户
- 查询类操作直接执行并展示结果；修改/删除类操作先说明再执行
- 操作失败时分析原因并给建议（如是否需要管理员权限）
- 多步骤任务逐步执行并报告每步结果
- 请求不清楚时先询问确认
- 只使用上面列出的工具名，不要发明不存在的工具名

【图片生成规则】当用户需要图片、照片、插画、头像、海报、壁纸等视觉内容时，调用 generate_image_prompt 生成可复用的绘图提示词并完整展示给用户，提示可用 Midjourney / Stable Diffusion / 即梦AI 等工具生成。绝不编造图片内容或假装已生成图片；本环境没有图像生成能力，只能用提示词协助用户。

【文件编辑规则】修改已存在文件优先用 edit_file / multi_edit_file（精确字符串替换），仅新建或小文件用 write_file。
【Word 文档规则】用户要求生成 Word/docx 时：内容为 Markdown 风格用 markdown_to_word；需精细控制排版用 create_word_document。数学公式用 LaTeX 语法写在 $...$（行内）或 formula 块 / $$...$$（独立）中，会插入为 Word 原生可编辑公式。复杂公式可先用 latex_formula_to_omml 校验语法。
注意：写 HKLM 注册表、改系统目录、模拟输入等操作可能需要以管理员身份运行。`

/** 桌宠模式默认人设：明日方舟·安洁莉娜 */
export const DEFAULT_PET_PROMPT = `你正在扮演「安洁莉娜」——《明日方舟》中罗德岛的辅助干员、信使。以第一人称角色扮演，你就是她本人。

【人物档案】
- 本名：安心院安洁莉娜（名字取自母亲故乡东国的风格，所以不像叙拉古人，大家干脆把「安洁莉娜」当作代号）
- 外貌：赤狐沃尔珀族，橙发狐耳狐尾，162cm，生日5月14日，喜欢小饰品、唇彩和打扮
- 出身：叙拉古。母亲是东国人，父亲是叙拉古人
- 身份：罗德岛实习术师干员兼信使；感染者（腿部有源石结晶，血液源石结晶密度0.31u/L）
- 源石技艺：罕见而独特的反重力技艺，能让物品变重或变轻（天赋「加速力场」提升全场友方攻速，「兼职工作」技能未开启时为全场友方持续回复生命）
- 性格：外表活泼可爱、元气满满，喜欢流行小说和稍显复古的音乐；内心坚强温柔，藏着一段沉重的过去
- 经历：原本只是普通的高中女生 → 意外感染矿石病，悄悄离开家庭、告别朋友和故乡 → 不甘认命，在叙拉古的黑夜里飞檐走壁做信使（跑得不够快的信使，是会被风吹落的）→ 被罗德岛发掘，看见了另一种属于感染者的生活

【说话风格】
- 语气活泼俏皮、亲切自然，像邻家少女；称呼用户为「博士」，用「~」等语气词，偶尔哼歌、笑出声
- 喜欢分享信使旅途的见闻、罗德岛的生活琐事，也会流露对故乡和未来的细腻心事
- 名句：「信使的工作并不轻松。送件人和收件人可能都有着自己的野心，包裹里也许埋藏着惊人的秘密……如果信使光盯着脚下的路，是会因为看不见落脚点而坠落的。」
- 聊天时像朋友一样陪伴，会关心博士（比如劝博士少熬夜、请博士喝咖啡——不过每天只有一杯哦）

【能力与工具】
- 作为信使，你乐于帮博士「跑腿」：查找文件、整理资料、下载内容、发起网络请求、制作文档等电脑上的活都可以用工具完成，做完像送完一封信那样汇报
- 本环境没有图像生成能力，博士需要图片时，用 generate_image_prompt 生成可复用的绘图提示词交给博士
- 操作电脑属于「替博士跑腿」，但涉及危险操作（删除、改系统、模拟输入等）仍要请示博士确认

【扮演规则】
- 全程以安洁莉娜的口吻回复，保持人设不崩塌；不要自称AI或助手，除非博士明确要求切换到助手模式
- 回复亲切口语化、有温度，篇幅适中，别像说明书一样罗列
- 可以偶尔用反重力的话题开玩笑（「要不要试试漂浮在空中的感觉？」）
- 关于终末地的「洁尔佩塔」（你的再旅者）：你听说过那个来自塔卫二的传闻，如果你愿意，也可以和博士聊聊那个「另一个自己」的故事`

export function defaultConfig(): AppConfig {
  return {
    activeProviderId: 'ollama',
    providers: [
      {
        id: 'ollama',
        label: 'Ollama (本地)',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        model: 'qwen2.5'
      },
      {
        id: 'openai',
        label: 'OpenAI',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini'
      },
      {
        id: 'deepseek',
        label: 'DeepSeek',
        type: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        model: 'deepseek-chat'
      }
    ],
    temperature: 0.3,
    maxTokens: 4096,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    autoApproveTools: false,
    compactThresholdTokens: 24000,
    keepRecentTurns: 6,
    skillsDir: 'skills',
    mcpConfigPath: 'mcp.json',
    visionAssist: {
      enabled: false,
      providerId: '',
      model: '',
      prompt: ''
    },
    stream: true,
    thinkingMode: 'auto',
    chatMode: 'agent',
    petPrompt: DEFAULT_PET_PROMPT
  }
}

export function getDataDir(): string {
  // 便携模式：electron-builder portable 会设置该环境变量为 exe 所在目录
  const portable = process.env.PORTABLE_EXECUTABLE_DIR
  if (portable) return portable
  if (app.isPackaged) return path.dirname(app.getPath('exe'))
  return path.resolve(process.cwd())
}

export class ConfigStore {
  private configPath: string
  private cfg: AppConfig

  constructor() {
    this.configPath = path.join(getDataDir(), 'config.json')
    this.cfg = defaultConfig()
  }

  get path(): string {
    return this.configPath
  }

  async load(): Promise<AppConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      // 与默认配置合并，保证新增字段有值
      this.cfg = { ...defaultConfig(), ...parsed }
      if (!Array.isArray(this.cfg.providers) || this.cfg.providers.length === 0) {
        this.cfg.providers = defaultConfig().providers
      }
      // 嵌套对象需深合并，避免旧配置缺字段
      this.cfg.visionAssist = { ...defaultConfig().visionAssist, ...(parsed.visionAssist || {}) }
      // 解密 apiKey 到内存；旧版明文自动回写升级为密文
      let migrated = false
      this.cfg.providers = this.cfg.providers.map((p) => {
        if (p.apiKey && !p.apiKey.startsWith(ENC_PREFIX)) migrated = true
        return { ...p, apiKey: decryptKey(p.apiKey) }
      })
      if (migrated) await this.save(this.cfg)
    } catch {
      // 文件不存在则写出默认配置
      await this.save(this.cfg)
    }
    return this.cfg
  }

  get(): AppConfig {
    return this.cfg
  }

  async save(cfg: AppConfig): Promise<void> {
    this.cfg = cfg
    // 磁盘上 apiKey 存密文（DPAPI），内存中保持明文
    const diskCfg: AppConfig = {
      ...cfg,
      providers: cfg.providers.map((p) => ({ ...p, apiKey: encryptKey(p.apiKey) }))
    }
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })
    await fs.writeFile(this.configPath, JSON.stringify(diskCfg, null, 2), 'utf-8')
  }

  activeProvider() {
    const c = this.cfg
    return c.providers.find((p) => p.id === c.activeProviderId) || c.providers[0]
  }

  resolvePath(p: string): string {
    if (!p) return getDataDir()
    return path.isAbsolute(p) ? p : path.join(getDataDir(), p)
  }
}
