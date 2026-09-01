import type { Tool } from './types'
import { str } from './types'
import { runPowerShell, psQuote } from '../util/powershell'

export const windowTools: Tool[] = [
  {
    schema: {
      name: 'find_windows',
      description: '查找窗口，按标题或进程名筛选，返回句柄、标题、进程',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '按标题部分匹配' },
          process: { type: 'string', description: '按进程名部分匹配' }
        },
        required: []
      }
    },
    async run(a) {
      const title = str(a.title).toLowerCase()
      const proc = str(a.process).toLowerCase().replace(/\.exe$/, '')
      const r = await runPowerShell(
        `Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Id,ProcessName,MainWindowTitle,@{N='H';E={$_.MainWindowHandle.ToInt64()}} | ConvertTo-Json -Compress`
      )
      let arr: any[] = []
      try {
        const p = JSON.parse(r.stdout || '[]')
        arr = Array.isArray(p) ? p : [p]
      } catch {
        return r.stdout || r.stderr
      }
      const rows = arr
        .filter(
          (w) =>
            (!title || String(w.MainWindowTitle).toLowerCase().includes(title)) &&
            (!proc || String(w.ProcessName).toLowerCase().includes(proc))
        )
        .map((w) => `hwnd=${w.H}  [${w.ProcessName}]  ${w.MainWindowTitle}`)
      return rows.join('\n') || '未找到窗口'
    }
  },
  {
    schema: {
      name: 'set_window_state',
      description: '最小化/最大化/还原窗口（按进程名或标题）',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '按标题匹配' },
          process: { type: 'string', description: '按进程名匹配' },
          state: { type: 'string', description: 'minimize/maximize/restore' }
        },
        required: ['state']
      }
    },
    dangerous: true,
    async run(a) {
      const stateMap: Record<string, number> = { minimize: 6, maximize: 3, restore: 9 }
      const sw = stateMap[str(a.state)] ?? 9
      const sel = a.title
        ? `Where-Object {$_.MainWindowTitle -like '*'+${psQuote(str(a.title))}+'*'}`
        : `Where-Object {$_.ProcessName -like '*'+${psQuote(str(a.process).replace(/\.exe$/, ''))}+'*'}`
      const script = `Add-Type @'
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}
'@;
$p=Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ${sel} | Select-Object -First 1;
if($p){[W]::ShowWindow($p.MainWindowHandle,${sw})|Out-Null;[W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null;Write-Output 'ok'}else{Write-Output 'notfound'}`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return `已${str(a.state)}窗口`
      if (r.stdout.includes('notfound')) return '未找到匹配窗口'
      throw new Error(r.stderr || '失败')
    }
  },
  {
    schema: {
      name: 'bring_window_to_front',
      description: '将窗口置于最前并激活',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '按标题匹配' },
          process: { type: 'string', description: '按进程名匹配' }
        },
        required: []
      }
    },
    dangerous: true,
    async run(a) {
      const sel = a.title
        ? `Where-Object {$_.MainWindowTitle -like '*'+${psQuote(str(a.title))}+'*'}`
        : `Where-Object {$_.ProcessName -like '*'+${psQuote(str(a.process).replace(/\.exe$/, ''))}+'*'}`
      const script = `Add-Type @'
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}
'@;
$p=Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ${sel} | Select-Object -First 1;
if($p){[W]::ShowWindow($p.MainWindowHandle,9)|Out-Null;[W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null;Write-Output 'ok'}else{Write-Output 'notfound'}`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return '已置顶窗口'
      if (r.stdout.includes('notfound')) return '未找到匹配窗口'
      throw new Error(r.stderr || '失败')
    }
  },
  {
    schema: {
      name: 'close_window',
      description: '关闭指定窗口（按进程名或标题）',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '按标题匹配' },
          process: { type: 'string', description: '按进程名匹配' }
        },
        required: []
      }
    },
    dangerous: true,
    async run(a) {
      const sel = a.title
        ? `Where-Object {$_.MainWindowTitle -like '*'+${psQuote(str(a.title))}+'*'}`
        : `Where-Object {$_.ProcessName -like '*'+${psQuote(str(a.process).replace(/\.exe$/, ''))}+'*'}`
      const script = `$p=Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ${sel};
if($p){$p | ForEach-Object {$_.CloseMainWindow()|Out-Null};Write-Output 'ok'}else{Write-Output 'notfound'}`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return '已请求关闭窗口'
      if (r.stdout.includes('notfound')) return '未找到匹配窗口'
      throw new Error(r.stderr || '失败')
    }
  }
]
