import type { Tool } from './types'
import { str, bool } from './types'
import { runPowerShell, psQuote } from '../util/powershell'

const HIVE_MAP: Record<string, string> = {
  HKLM: 'HKLM',
  HKCU: 'HKCU',
  HKCR: 'HKCR',
  HKU: 'HKU',
  HKCC: 'HKCC'
}

function psPath(hive: string, key: string): string {
  const h = HIVE_MAP[hive.toUpperCase()] || 'HKCU'
  return `${h}:\\${key.replace(/^\\+/, '')}`
}

export const registryTools: Tool[] = [
  {
    schema: {
      name: 'registry_list',
      description: '列出注册表键的子键和值',
      parameters: {
        type: 'object',
        properties: {
          hive: { type: 'string', description: 'HKLM/HKCU/HKCR/HKU/HKCC' },
          key: { type: 'string', description: '子键路径' }
        },
        required: ['hive', 'key']
      }
    },
    async run(a) {
      const p = psPath(str(a.hive), str(a.key))
      const script = `$p=${psQuote(p)};
$subs=(Get-ChildItem -Path $p -ErrorAction SilentlyContinue | ForEach-Object {$_.PSChildName});
$vals=(Get-ItemProperty -Path $p -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object {$_.Name -notlike 'PS*'} | ForEach-Object {$_.Name+' = '+$_.Value};
"子键:";$subs -join "\`n";"值:";$vals -join "\`n"`
      const r = await runPowerShell(script)
      return r.stdout.trim() || r.stderr || '（空）'
    }
  },
  {
    schema: {
      name: 'registry_read',
      description: '读取注册表值',
      parameters: {
        type: 'object',
        properties: {
          hive: { type: 'string', description: 'HKLM/HKCU/...' },
          key: { type: 'string', description: '子键路径' },
          value_name: { type: 'string', description: '值名称（空为默认值）' }
        },
        required: ['hive', 'key', 'value_name']
      }
    },
    async run(a) {
      const p = psPath(str(a.hive), str(a.key))
      const script = `(Get-ItemProperty -Path ${psQuote(p)} -Name ${psQuote(str(a.value_name))} -ErrorAction Stop).${str(a.value_name).replace(/[^\w]/g, '') || '(default)'}`
      const r = await runPowerShell(script)
      return (r.stdout.trim() || r.stderr).trim()
    }
  },
  {
    schema: {
      name: 'registry_write',
      description: '写入或创建注册表值',
      parameters: {
        type: 'object',
        properties: {
          hive: { type: 'string', description: 'HKLM/HKCU' },
          key: { type: 'string', description: '子键路径（不存在则创建）' },
          value_name: { type: 'string', description: '值名称' },
          value_data: { type: 'string', description: '值数据' },
          value_type: { type: 'string', description: 'String(默认)/DWord/QWord/Binary/ExpandString/MultiString' }
        },
        required: ['hive', 'key', 'value_name', 'value_data']
      }
    },
    dangerous: true,
    async run(a) {
      const p = psPath(str(a.hive), str(a.key))
      const type = str(a.value_type, 'String')
      const script = `if(!(Test-Path ${psQuote(p)})){New-Item -Path ${psQuote(p)} -Force | Out-Null};
New-ItemProperty -Path ${psQuote(p)} -Name ${psQuote(str(a.value_name))} -Value ${psQuote(str(a.value_data))} -PropertyType ${type} -Force | Out-Null;Write-Output 'ok'`
      const r = await runPowerShell(script)
      if (r.stdout.includes('ok')) return `已写入: ${p}\\${str(a.value_name)}`
      throw new Error(r.stderr || '写入失败（HKLM 可能需要管理员权限）')
    }
  },
  {
    schema: {
      name: 'registry_delete_value',
      description: '删除注册表值',
      parameters: {
        type: 'object',
        properties: {
          hive: { type: 'string', description: 'HKLM/HKCU' },
          key: { type: 'string', description: '子键路径' },
          value_name: { type: 'string', description: '要删除的值名称' }
        },
        required: ['hive', 'key', 'value_name']
      }
    },
    dangerous: true,
    async run(a) {
      const p = psPath(str(a.hive), str(a.key))
      const r = await runPowerShell(
        `Remove-ItemProperty -Path ${psQuote(p)} -Name ${psQuote(str(a.value_name))} -ErrorAction Stop;Write-Output 'ok'`
      )
      if (r.stdout.includes('ok')) return `已删除值: ${p}\\${str(a.value_name)}`
      throw new Error(r.stderr || '失败')
    }
  },
  {
    schema: {
      name: 'registry_delete_key',
      description: '删除注册表键（及其所有子键和值）',
      parameters: {
        type: 'object',
        properties: {
          hive: { type: 'string', description: 'HKLM/HKCU' },
          key: { type: 'string', description: '要删除的子键路径' },
          recursive: { type: 'boolean', description: '是否递归，默认 true' }
        },
        required: ['hive', 'key']
      }
    },
    dangerous: true,
    async run(a) {
      const p = psPath(str(a.hive), str(a.key))
      const rec = a.recursive === undefined ? true : bool(a.recursive)
      const r = await runPowerShell(
        `Remove-Item -Path ${psQuote(p)} ${rec ? '-Recurse' : ''} -Force -ErrorAction Stop;Write-Output 'ok'`
      )
      if (r.stdout.includes('ok')) return `已删除键: ${p}`
      throw new Error(r.stderr || '失败')
    }
  }
]
