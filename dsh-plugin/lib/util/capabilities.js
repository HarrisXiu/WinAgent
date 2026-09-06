"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCapabilities = getCapabilities;
/**
 * 本地能力探测：pandoc / LibreOffice / Office COM / pdfjs 渲染链 / PyMuPDF。
 * 结果进程内缓存；供 markdown_to_docx 引擎选择、office_convert 降级链与系统提示词能力注入共用。
 * 探测均为轻量子进程/注册表/文件检查，失败即视为能力不存在（不抛错）。
 * @module dsh-winagent/capabilities
 */
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const module_1 = require("module");
const platform_1 = require("../platform");
const Logger_1 = require("./Logger");
const packageRequire = (0, module_1.createRequire)(path_1.default.join(platform_1.PACKAGE_ROOT, 'package.json'));
function probeCmd(cmd, args, timeout = 8000) {
    try {
        const r = (0, child_process_1.spawnSync)(cmd, args, { timeout, encoding: 'utf8', windowsHide: true });
        if (r.status === 0) {
            return (((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/)[0] || '').slice(0, 120);
        }
        return null;
    }
    catch {
        return null;
    }
}
function probeOfficeCom() {
    // 注册表探测 Word.Application COM 注册（比启动 COM 快且无副作用）；非 Windows 恒 false
    if (process.platform !== 'win32')
        return false;
    try {
        const r = (0, child_process_1.spawnSync)('reg', ['query', 'HKEY_CLASSES_ROOT\\Word.Application', '/ve'], {
            timeout: 5000,
            encoding: 'utf8',
            windowsHide: true
        });
        return r.status === 0;
    }
    catch {
        return false;
    }
}
/** 定位包安装目录（resolve 失败时按解析路径列表逐一探测，兼容 exports 字段限制） */
function packageDir(name) {
    try {
        return path_1.default.dirname(packageRequire.resolve(`${name}/package.json`));
    }
    catch { /* exports 限制或未安装 */ }
    try {
        for (const p of packageRequire.resolve.paths(name) || []) {
            const d = path_1.default.join(p, name);
            if (fs_1.default.existsSync(path_1.default.join(d, 'package.json')))
                return d;
        }
    }
    catch { /* ignore */ }
    return null;
}
function probePdfjsRender() {
    const pdfjsDir = packageDir('pdfjs-dist');
    if (!pdfjsDir)
        return false;
    if (!fs_1.default.existsSync(path_1.default.join(pdfjsDir, 'legacy', 'build', 'pdf.mjs')))
        return false;
    try {
        packageRequire.resolve('@napi-rs/canvas');
        return true;
    }
    catch {
        return false;
    }
}
function probePymupdf() {
    // WindowsApps 存在 python stub 问题：先试 python，再试 py -3
    const importOk = (cmd, args) => {
        try {
            const r = (0, child_process_1.spawnSync)(cmd, args, { timeout: 15000, encoding: 'utf8', windowsHide: true });
            return r.status === 0;
        }
        catch {
            return false;
        }
    };
    if (importOk('python', ['-c', 'import fitz']))
        return true;
    return importOk('py', ['-3', '-c', 'import fitz']);
}
function probeSoffice() {
    const candidates = [
        'soffice',
        'soffice.exe',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ];
    for (const c of candidates) {
        const v = probeCmd(c, ['--version'], 10000);
        if (v)
            return { version: v, cmd: c };
    }
    return { version: null, cmd: null };
}
let cached = null;
/** 探测本地能力（进程内缓存；force=true 强制重探） */
function getCapabilities(force = false) {
    if (cached && !force)
        return cached;
    const soffice = probeSoffice();
    cached = {
        pandoc: probeCmd('pandoc', ['--version']),
        soffice: soffice.version,
        sofficeCmd: soffice.cmd,
        officeCom: probeOfficeCom(),
        pdfjsRender: probePdfjsRender(),
        pymupdf: probePymupdf()
    };
    Logger_1.Logger.info(`[Capabilities] pandoc=${cached.pandoc ? '✓' : '✗'} soffice=${cached.soffice ? '✓' : '✗'} ` +
        `officeCom=${cached.officeCom ? '✓' : '✗'} pdfjsRender=${cached.pdfjsRender ? '✓' : '✗'} pymupdf=${cached.pymupdf ? '✓' : '✗'}`);
    return cached;
}
