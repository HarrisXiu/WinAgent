"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registryTools = void 0;
const types_1 = require("./types");
const powershell_1 = require("../util/powershell");
const HIVE_MAP = {
    HKLM: 'HKLM',
    HKCU: 'HKCU',
    HKCR: 'HKCR',
    HKU: 'HKU',
    HKCC: 'HKCC'
};
function psPath(hive, key) {
    const h = HIVE_MAP[hive.toUpperCase()] || 'HKCU';
    return `${h}:\\${key.replace(/^\\+/, '')}`;
}
exports.registryTools = [
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
            const p = psPath((0, types_1.str)(a.hive), (0, types_1.str)(a.key));
            const script = `$p=${(0, powershell_1.psQuote)(p)};
$subs=(Get-ChildItem -Path $p -ErrorAction SilentlyContinue | ForEach-Object {$_.PSChildName});
$vals=(Get-ItemProperty -Path $p -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object {$_.Name -notlike 'PS*'} | ForEach-Object {$_.Name+' = '+$_.Value};
"子键:";$subs -join "\`n";"值:";$vals -join "\`n"`;
            const r = await (0, powershell_1.runPowerShell)(script);
            return r.stdout.trim() || r.stderr || '（空）';
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
            const p = psPath((0, types_1.str)(a.hive), (0, types_1.str)(a.key));
            const script = `(Get-ItemProperty -Path ${(0, powershell_1.psQuote)(p)} -Name ${(0, powershell_1.psQuote)((0, types_1.str)(a.value_name))} -ErrorAction Stop).${(0, types_1.str)(a.value_name).replace(/[^\w]/g, '') || '(default)'}`;
            const r = await (0, powershell_1.runPowerShell)(script);
            return (r.stdout.trim() || r.stderr).trim();
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
            const p = psPath((0, types_1.str)(a.hive), (0, types_1.str)(a.key));
            const type = (0, types_1.str)(a.value_type, 'String');
            const script = `if(!(Test-Path ${(0, powershell_1.psQuote)(p)})){New-Item -Path ${(0, powershell_1.psQuote)(p)} -Force | Out-Null};
New-ItemProperty -Path ${(0, powershell_1.psQuote)(p)} -Name ${(0, powershell_1.psQuote)((0, types_1.str)(a.value_name))} -Value ${(0, powershell_1.psQuote)((0, types_1.str)(a.value_data))} -PropertyType ${type} -Force | Out-Null;Write-Output 'ok'`;
            const r = await (0, powershell_1.runPowerShell)(script);
            if (r.stdout.includes('ok'))
                return `已写入: ${p}\\${(0, types_1.str)(a.value_name)}`;
            throw new Error(r.stderr || '写入失败（HKLM 可能需要管理员权限）');
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
            const p = psPath((0, types_1.str)(a.hive), (0, types_1.str)(a.key));
            const r = await (0, powershell_1.runPowerShell)(`Remove-ItemProperty -Path ${(0, powershell_1.psQuote)(p)} -Name ${(0, powershell_1.psQuote)((0, types_1.str)(a.value_name))} -ErrorAction Stop;Write-Output 'ok'`);
            if (r.stdout.includes('ok'))
                return `已删除值: ${p}\\${(0, types_1.str)(a.value_name)}`;
            throw new Error(r.stderr || '失败');
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
            const p = psPath((0, types_1.str)(a.hive), (0, types_1.str)(a.key));
            const rec = a.recursive === undefined ? true : (0, types_1.bool)(a.recursive);
            const r = await (0, powershell_1.runPowerShell)(`Remove-Item -Path ${(0, powershell_1.psQuote)(p)} ${rec ? '-Recurse' : ''} -Force -ErrorAction Stop;Write-Output 'ok'`);
            if (r.stdout.includes('ok'))
                return `已删除键: ${p}`;
            throw new Error(r.stderr || '失败');
        }
    }
];
