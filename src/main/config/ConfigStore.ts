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

【可用工具完整列表】
文件操作：list_directory, read_file, write_file, edit_file, multi_edit_file, delete_file, copy_file, move_file, search_files, find_files, get_file_info, create_directory, grep
系统操作：list_processes, kill_process, run_command, get_system_info, take_screenshot, list_startup_items, add_startup_item, remove_startup_item
注册表：registry_list, registry_read, registry_write, registry_delete_value, registry_delete_key
输入模拟：mouse_move, mouse_click, mouse_scroll, key_press, key_combination, type_text, get_cursor_pos, get_screen_size
窗口管理：find_windows, set_window_state, bring_window_to_front, close_window
网络：http_request, http_download
Word 文档：create_word_document, markdown_to_word, latex_formula_to_omml

执行规则：
- 用中文回复用户
- 查询类操作直接执行并展示结果；修改/删除类操作先说明再执行
- 操作失败时分析原因并给建议（如是否需要管理员权限）
- 多步骤任务逐步执行并报告每步结果
- 请求不清楚时先询问确认
- 只使用上面列出的工具名，不要发明不存在的工具名

【文件编辑规则】修改已存在文件优先用 edit_file / multi_edit_file（精确字符串替换），仅新建或小文件用 write_file。
【Word 文档规则】用户要求生成 Word/docx 时：内容为 Markdown 风格用 markdown_to_word；需精细控制排版用 create_word_document。数学公式用 LaTeX 语法写在 $...$（行内）或 formula 块 / $$...$$（独立）中，会插入为 Word 原生可编辑公式。复杂公式可先用 latex_formula_to_omml 校验语法。
注意：写 HKLM 注册表、改系统目录、模拟输入等操作可能需要以管理员身份运行。`

export function getDataDir(): string {
  // 便携模式：electron-builder portable 会设置该环境变量为 exe 所在目录
  const portable = process.env.PORTABLE_EXECUTABLE_DIR
  if (portable) return portable
  if (app.isPackaged) return path.dirname(app.getPath('exe'))
  return path.resolve(process.cwd())
}

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
    mcpConfigPath: 'mcp.json'
  }
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
