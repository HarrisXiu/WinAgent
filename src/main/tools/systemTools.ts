import path from 'path'
import os from 'os'
import type { Tool } from './types'
import { str, num, bool } from './types'
import { runCmd, runPowerShell, psQuote } from '../util/powershell'

function desktopPath(save?: string): string {
  if (save) return save
  return path.join(os.homedir(), 'Desktop', `screenshot_${Date.now()}.png`)
}

export const systemTools: Tool[] = [
  {
    schema: {
      name: 'list_processes',
      description: '列出当前运行的进程',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: '按进程名过滤（部分匹配）' },
          max: { type: 'integer', description: '最多返回数，默认 50' }
        },
        required: []
      }
    },
    async run(a) {
      const max = num(a.max, 50)
      const filter = str(a.filter).toLowerCase()
      const r = await runPowerShell(
        `Get-Process | Select-Object Id,ProcessName,@{N='MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress`
      )
      let arr: any[] = []
      try {
        const parsed = JSON.parse(r.stdout || '[]')
        arr = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return r.stdout || r.stderr
      }
      const rows = arr
        .filter((p) => !filter || String(p.ProcessName).toLowerCase().includes(filter))
        .slice(0, max)
        .map((p) => `${String(p.Id).padStart(6)}  ${p.ProcessName}  (${p.MB} MB)`)
      return rows.join('\n') || '无匹配进程'
    }
  },
  {
    schema: {
      name: 'kill_process',
      description: '结束进程（按 PID 或名称）',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'integer', description: '进程 ID' },
          name: { type: 'string', description: '进程名（如 notepad.exe）' }
        },
        required: []
      }
    },
    dangerous: true,
    async run(a) {
      if (a.pid !== undefined) {
        const r = await runCmd(`taskkill /PID ${num(a.pid)} /F`)
        return (r.stdout || r.stderr).trim()
      }
      if (a.name) {
        const r = await runCmd(`taskkill /IM ${str(a.name)} /F`)
        return (r.stdout || r.stderr).trim()
      }
      throw new Error('需提供 pid 或 name')
    }
  },
  {
    schema: {
      name: 'run_command',
      description: '执行命令行命令并返回输出（cmd）。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          cwd: { type: 'string', description: '工作目录（可选）' }
        },
        required: ['command']
      }
    },
    dangerous: true,
    async run(a) {
      const r = await runCmd(str(a.command), a.cwd ? str(a.cwd) : undefined)
      const out = (r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '')).trim()
      return out || `（无输出，退出码 ${r.code}）`
    }
  },
  {
    schema: {
      name: 'get_system_info',
      description: '获取系统基本信息（OS、内存、CPU、用户）',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    async run() {
      const mem = os.totalmem() / 1024 / 1024 / 1024
      const free = os.freemem() / 1024 / 1024 / 1024
      return [
        `主机名: ${os.hostname()}`,
        `用户: ${os.userInfo().username}`,
        `系统: ${os.type()} ${os.release()} (${os.arch()})`,
        `CPU: ${os.cpus()[0]?.model} × ${os.cpus().length}`,
        `内存: ${free.toFixed(1)} GB 可用 / ${mem.toFixed(1)} GB 总`,
        `用户目录: ${os.homedir()}`
      ].join('\n')
    }
  },
  {
    schema: {
      name: 'take_screenshot',
      description: '全屏截图并保存到文件（默认保存到桌面）',
      parameters: {
        type: 'object',
        properties: { save_path: { type: 'string', description: '保存路径（可选）' } },
        required: []
      }
    },
    async run(a) {
      const out = desktopPath(a.save_path ? str(a.save_path) : undefined)
      const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;
$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height);
$g=[System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);
$bmp.Save(${psQuote(out)},[System.Drawing.Imaging.ImageFormat]::Png);
$g.Dispose();$bmp.Dispose();Write-Output 'ok'`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return `已截图: ${out}`
      throw new Error(r.stderr || '截图失败')
    }
  },
  {
    schema: {
      name: 'list_startup_items',
      description: '列出开机自启动项（注册表 Run 键）',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    async run() {
      const script = `$out=@();
foreach($h in 'HKCU','HKLM'){
 $p="$h:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
 if(Test-Path $p){(Get-ItemProperty $p).PSObject.Properties|Where-Object{$_.Name -notlike 'PS*'}|ForEach-Object{$out+=("[$h] "+$_.Name+" = "+$_.Value)}}}
$out -join "\`n"`
      const r = await runPowerShell(script)
      return r.stdout.trim() || '无启动项'
    }
  },
  {
    schema: {
      name: 'add_startup_item',
      description: '添加开机自启动项到 HKCU Run',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '启动项名称' },
          command: { type: 'string', description: '可执行文件路径/命令' }
        },
        required: ['name', 'command']
      }
    },
    dangerous: true,
    async run(a) {
      const script = `Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${psQuote(str(a.name))} -Value ${psQuote(str(a.command))};Write-Output 'ok'`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return `已添加启动项: ${str(a.name)}`
      throw new Error(r.stderr || '失败')
    }
  },
  {
    schema: {
      name: 'remove_startup_item',
      description: '从 HKCU Run 移除自启动项',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '启动项名称' } },
        required: ['name']
      }
    },
    dangerous: true,
    async run(a) {
      const script = `Remove-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${psQuote(str(a.name))} -ErrorAction Stop;Write-Output 'ok'`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return `已移除启动项: ${str(a.name)}`
      throw new Error(r.stderr || '失败')
    }
  }
]
