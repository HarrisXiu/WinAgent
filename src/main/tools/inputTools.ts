import type { Tool } from './types'
import { str, num, bool } from './types'
import { runPowerShell, psQuote } from '../util/powershell'

const USER32 = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class U32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@`

// SendKeys 特殊字符转义
function escapeSendKeys(text: string): string {
  return text.replace(/([+^%~(){}\[\]])/g, '{$1}')
}

// 键名 -> SendKeys 记法
const KEY_MAP: Record<string, string> = {
  enter: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  esc: '{ESC}',
  space: ' ',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}'
}

function keyToSendKeys(key: string): string {
  const k = key.toLowerCase()
  if (KEY_MAP[k]) return KEY_MAP[k]
  if (/^f([1-9]|1[0-2])$/.test(k)) return `{${k.toUpperCase()}}`
  return escapeSendKeys(key)
}

const MOD_MAP: Record<string, string> = { ctrl: '^', control: '^', alt: '%', shift: '+', win: '^{ESC}' }

function comboToSendKeys(keys: string): string {
  const parts = keys.split('+').map((s) => s.trim().toLowerCase())
  let prefix = ''
  let main = ''
  for (const p of parts) {
    if (MOD_MAP[p] && p !== 'win') prefix += MOD_MAP[p]
    else main += keyToSendKeys(p)
  }
  return prefix + main
}

export const inputTools: Tool[] = [
  {
    schema: {
      name: 'mouse_move',
      description: '移动鼠标到指定屏幕坐标',
      parameters: {
        type: 'object',
        properties: { x: { type: 'integer' }, y: { type: 'integer' } },
        required: ['x', 'y']
      }
    },
    dangerous: true,
    async run(a) {
      await runPowerShell(`${USER32};[U32]::SetCursorPos(${num(a.x)},${num(a.y)})|Out-Null`)
      return `鼠标移动到 (${num(a.x)},${num(a.y)})`
    }
  },
  {
    schema: {
      name: 'mouse_click',
      description: '在指定位置点击鼠标（不填坐标则在当前位置）',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'integer' },
          y: { type: 'integer' },
          button: { type: 'string', description: 'left(默认)/right/middle' },
          double_click: { type: 'boolean', description: '是否双击' }
        },
        required: []
      }
    },
    dangerous: true,
    async run(a) {
      const btn = str(a.button, 'left')
      const down = btn === 'right' ? 0x0008 : btn === 'middle' ? 0x0020 : 0x0002
      const up = btn === 'right' ? 0x0010 : btn === 'middle' ? 0x0040 : 0x0004
      const move = a.x !== undefined && a.y !== undefined ? `[U32]::SetCursorPos(${num(a.x)},${num(a.y)})|Out-Null;` : ''
      const clickOnce = `[U32]::mouse_event(${down},0,0,0,[IntPtr]::Zero);[U32]::mouse_event(${up},0,0,0,[IntPtr]::Zero);`
      const clicks = bool(a.double_click) ? clickOnce + 'Start-Sleep -m 60;' + clickOnce : clickOnce
      await runPowerShell(`${USER32};${move}${clicks}`)
      return `已${bool(a.double_click) ? '双' : ''}击(${btn})`
    }
  },
  {
    schema: {
      name: 'mouse_scroll',
      description: '滚动鼠标滚轮（delta 正数向上，负数向下）',
      parameters: {
        type: 'object',
        properties: { delta: { type: 'integer', description: '如 3 或 -3' } },
        required: ['delta']
      }
    },
    dangerous: true,
    async run(a) {
      const amount = num(a.delta) * 120
      await runPowerShell(`${USER32};[U32]::mouse_event(0x0800,0,0,${amount >>> 0 === amount ? amount : (amount >>> 0)},[IntPtr]::Zero)`)
      return `已滚动 ${num(a.delta)}`
    }
  },
  {
    schema: {
      name: 'key_press',
      description: '按下并释放一个键',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'enter/tab/esc/f1-f12/单字符等' } },
        required: ['key']
      }
    },
    dangerous: true,
    async run(a) {
      const sk = keyToSendKeys(str(a.key))
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait(${psQuote(sk)})`
      )
      return `已按键: ${str(a.key)}`
    }
  },
  {
    schema: {
      name: 'key_combination',
      description: '按下组合键（如 ctrl+c、alt+f4）',
      parameters: {
        type: 'object',
        properties: { keys: { type: 'string', description: '用 + 连接，如 ctrl+c' } },
        required: ['keys']
      }
    },
    dangerous: true,
    async run(a) {
      const sk = comboToSendKeys(str(a.keys))
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait(${psQuote(sk)})`
      )
      return `已发送组合键: ${str(a.keys)}`
    }
  },
  {
    schema: {
      name: 'type_text',
      description: '模拟键盘输入文本',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '要输入的文本' } },
        required: ['text']
      }
    },
    dangerous: true,
    async run(a) {
      const sk = escapeSendKeys(str(a.text))
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait(${psQuote(sk)})`
      )
      return `已输入 ${str(a.text).length} 字符`
    }
  },
  {
    schema: {
      name: 'get_cursor_pos',
      description: '获取当前鼠标位置',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    async run() {
      const r = await runPowerShell(`${USER32};$p=New-Object U32+POINT;[U32]::GetCursorPos([ref]$p)|Out-Null;"$($p.X),$($p.Y)"`)
      return `光标位置: ${r.stdout.trim()}`
    }
  },
  {
    schema: {
      name: 'get_screen_size',
      description: '获取屏幕分辨率',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    async run() {
      const r = await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms;$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"$($s.Width)x$($s.Height)"`
      )
      return `屏幕分辨率: ${r.stdout.trim()}`
    }
  }
]
