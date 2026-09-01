"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemTools = void 0;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const types_1 = require("./types");
const powershell_1 = require("../util/powershell");
function desktopPath(save) {
    if (save)
        return save;
    return path_1.default.join(os_1.default.homedir(), 'Desktop', `screenshot_${Date.now()}.png`);
}
exports.systemTools = [
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
            const max = (0, types_1.num)(a.max, 50);
            const filter = (0, types_1.str)(a.filter).toLowerCase();
            const r = await (0, powershell_1.runPowerShell)(`Get-Process | Select-Object Id,ProcessName,@{N='MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress`);
            let arr = [];
            try {
                const parsed = JSON.parse(r.stdout || '[]');
                arr = Array.isArray(parsed) ? parsed : [parsed];
            }
            catch {
                return r.stdout || r.stderr;
            }
            const rows = arr
                .filter((p) => !filter || String(p.ProcessName).toLowerCase().includes(filter))
                .slice(0, max)
                .map((p) => `${String(p.Id).padStart(6)}  ${p.ProcessName}  (${p.MB} MB)`);
            return rows.join('\n') || '无匹配进程';
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
                const r = await (0, powershell_1.runCmd)(`taskkill /PID ${(0, types_1.num)(a.pid)} /F`);
                return (r.stdout || r.stderr).trim();
            }
            if (a.name) {
                const r = await (0, powershell_1.runCmd)(`taskkill /IM ${(0, types_1.str)(a.name)} /F`);
                return (r.stdout || r.stderr).trim();
            }
            throw new Error('需提供 pid 或 name');
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
            const r = await (0, powershell_1.runCmd)((0, types_1.str)(a.command), a.cwd ? (0, types_1.str)(a.cwd) : undefined);
            const out = (r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '')).trim();
            return out || `（无输出，退出码 ${r.code}）`;
        }
    },
    {
        schema: {
            name: 'get_system_info',
            description: '获取系统基本信息（OS、内存、CPU、用户）',
            parameters: { type: 'object', properties: {}, required: [] }
        },
        async run() {
            const mem = os_1.default.totalmem() / 1024 / 1024 / 1024;
            const free = os_1.default.freemem() / 1024 / 1024 / 1024;
            return [
                `主机名: ${os_1.default.hostname()}`,
                `用户: ${os_1.default.userInfo().username}`,
                `系统: ${os_1.default.type()} ${os_1.default.release()} (${os_1.default.arch()})`,
                `CPU: ${os_1.default.cpus()[0]?.model} × ${os_1.default.cpus().length}`,
                `内存: ${free.toFixed(1)} GB 可用 / ${mem.toFixed(1)} GB 总`,
                `用户目录: ${os_1.default.homedir()}`
            ].join('\n');
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
            const out = desktopPath(a.save_path ? (0, types_1.str)(a.save_path) : undefined);
            const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;
$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height);
$g=[System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);
$bmp.Save(${(0, powershell_1.psQuote)(out)},[System.Drawing.Imaging.ImageFormat]::Png);
$g.Dispose();$bmp.Dispose();Write-Output 'ok'`;
            const r = await (0, powershell_1.runPowerShell)(script);
            if (r.stdout.includes('ok'))
                return `已截图: ${out}`;
            throw new Error(r.stderr || '截图失败');
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
$out -join "\`n"`;
            const r = await (0, powershell_1.runPowerShell)(script);
            return r.stdout.trim() || '无启动项';
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
            const script = `Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${(0, powershell_1.psQuote)((0, types_1.str)(a.name))} -Value ${(0, powershell_1.psQuote)((0, types_1.str)(a.command))};Write-Output 'ok'`;
            const r = await (0, powershell_1.runPowerShell)(script);
            if (r.stdout.includes('ok'))
                return `已添加启动项: ${(0, types_1.str)(a.name)}`;
            throw new Error(r.stderr || '失败');
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
            const script = `Remove-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${(0, powershell_1.psQuote)((0, types_1.str)(a.name))} -ErrorAction Stop;Write-Output 'ok'`;
            const r = await (0, powershell_1.runPowerShell)(script);
            if (r.stdout.includes('ok'))
                return `已移除启动项: ${(0, types_1.str)(a.name)}`;
            throw new Error(r.stderr || '失败');
        }
    }
];
