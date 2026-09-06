"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.officeTools = void 0;
/**
 * Office 生成工具族：markdown_to_docx / write_xlsx / write_pptx。
 * 模式一致：模型产出结构化内容（Markdown / JSON），本模块做确定性序列化。
 * markdown_to_docx 双引擎：检测到 pandoc 优先（样式/公式更成熟），否则内置纯 JS DocxBuilder 链。
 * @module dsh-winagent/office-tools
 */
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const XLSX = __importStar(require("xlsx"));
const pptxgenjs_1 = __importDefault(require("pptxgenjs"));
const types_1 = require("./types");
const DocxBuilder_1 = require("../docx/DocxBuilder");
const capabilities_1 = require("../util/capabilities");
const powershell_1 = require("../util/powershell");
const Logger_1 = require("../util/Logger");
// ── 通用辅助 ──────────────────────────────────────
/** 保存路径解析：相对路径基于 cwd，补齐扩展名 */
function resolveSavePath(savePath, ext) {
    const out = path_1.default.isAbsolute(savePath) ? savePath : path_1.default.resolve(savePath);
    return out.toLowerCase().endsWith(ext) ? out : out + ext;
}
async function ensureParentDir(filePath) {
    await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
}
/** 解析数组参数（接受 JSON 字符串或已解析数组） */
function parseArrayArg(v, label) {
    let arr = v;
    if (typeof v === 'string') {
        try {
            arr = JSON.parse(v);
        }
        catch (e) {
            throw new Error(`${label} JSON 解析失败: ${e.message}（前100字符: ${v.slice(0, 100)}）`);
        }
    }
    if (!Array.isArray(arr))
        throw new Error(`${label} 必须是数组`);
    return arr;
}
// ── Markdown → 文档块（内置 JS 引擎） ─────────────
/** 把 Markdown 风格文本转为文档块 */
function markdownToBlocks(md) {
    const blocks = [];
    const lines = md.split(/\r?\n/);
    let listBuf = [];
    let listOrdered = false;
    let tableBuf = [];
    const flushList = () => {
        if (listBuf.length) {
            blocks.push({ type: 'list', items: listBuf, ordered: listOrdered });
            listBuf = [];
        }
    };
    const flushTable = () => {
        if (tableBuf.length) {
            blocks.push({ type: 'table', rows: tableBuf, header: true });
            tableBuf = [];
        }
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        // 块级公式 $$...$$（可跨行）
        if (t.startsWith('$$')) {
            flushList();
            flushTable();
            const single = t.slice(2).replace(/\$\$$/, '').trim();
            if (t.endsWith('$$') && t.length > 4 && single) {
                blocks.push({ type: 'formula', latex: single });
            }
            else {
                const buf = [t.slice(2)];
                while (++i < lines.length && !lines[i].trim().endsWith('$$'))
                    buf.push(lines[i]);
                if (i < lines.length)
                    buf.push(lines[i].trim().replace(/\$\$$/, ''));
                blocks.push({ type: 'formula', latex: buf.join('\n').trim() });
            }
            continue;
        }
        // 表格行 | a | b |
        if (/^\|.*\|$/.test(t)) {
            flushList();
            const cells = t.slice(1, -1).split('|').map((c) => c.trim());
            // 跳过 |---|---| 分隔行
            if (!cells.every((c) => /^:?-{2,}:?$/.test(c)))
                tableBuf.push(cells);
            continue;
        }
        flushTable();
        // 标题
        const h = /^(#{1,6})\s+(.*)$/.exec(t);
        if (h) {
            flushList();
            blocks.push({ type: 'heading', text: h[2], level: h[1].length });
            continue;
        }
        // 列表
        const ul = /^[-*+]\s+(.*)$/.exec(t);
        const ol = /^\d+[.)]\s+(.*)$/.exec(t);
        if (ul || ol) {
            const ordered = !!ol;
            if (listBuf.length && ordered !== listOrdered)
                flushList();
            listOrdered = ordered;
            listBuf.push((ul ? ul[1] : ol[1]));
            continue;
        }
        flushList();
        if (!t)
            continue;
        if (/^(-{3,}|\*{3,})$/.test(t)) {
            blocks.push({ type: 'pagebreak' });
            continue;
        }
        blocks.push({ type: 'paragraph', text: t });
    }
    flushList();
    flushTable();
    return blocks;
}
function buildOpts(a) {
    return {
        title: a.title ? (0, types_1.str)(a.title) : undefined,
        author: a.author ? (0, types_1.str)(a.author) : undefined,
        fontName: a.font_name ? (0, types_1.str)(a.font_name) : undefined,
        fontSize: a.font_size ? (0, types_1.num)(a.font_size, 11) : undefined,
        landscape: (0, types_1.bool)(a.landscape, false)
    };
}
/** pandoc 引擎：gfm + $...$ LaTeX 公式 → Word 原生 OMML */
async function pandocToDocx(md, outPath, meta) {
    const tmp = path_1.default.join(os_1.default.tmpdir(), `wa-md-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.md`);
    await fs_1.promises.writeFile(tmp, md, 'utf-8');
    try {
        const args = ['-f', 'gfm+tex_math_dollars', '-t', 'docx', '-o', outPath];
        if (meta.title)
            args.push('--metadata', `title=${meta.title}`);
        if (meta.author)
            args.push('--metadata', `author=${meta.author}`);
        const r = (0, child_process_1.spawnSync)('pandoc', [...args, tmp], { timeout: 60000, encoding: 'utf8', windowsHide: true });
        if (r.status !== 0) {
            throw new Error(((r.stderr || r.stdout) || `pandoc 退出码 ${r.status}`).trim());
        }
    }
    finally {
        await fs_1.promises.unlink(tmp).catch(() => { });
    }
}
// ── Excel：markdown 表格 / sheets JSON → xlsx ────
/** 单元格值收敛：纯数字字符串转数字，其余转字符串 */
function coerceCell(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    const s = String(v);
    if (s.trim() !== '') {
        const n = Number(s);
        if (Number.isFinite(n))
            return n;
    }
    return s;
}
function parseSheetsArg(v) {
    const arr = parseArrayArg(v, 'sheets');
    return arr.map((s, i) => {
        if (!s || typeof s !== 'object' || !Array.isArray(s.rows)) {
            throw new Error(`sheets[${i}] 缺少 rows 数组（每项 {name?, rows:[][]}）`);
        }
        return {
            name: s.name ? String(s.name).slice(0, 31) : `Sheet${i + 1}`,
            rows: s.rows.map((r) => (Array.isArray(r) ? r.map(coerceCell) : [coerceCell(r)]))
        };
    });
}
/** markdown 表格文本 → sheets（每个连续表格块一张工作表） */
function markdownToSheets(md) {
    const sheets = [];
    let current = [];
    const flush = () => {
        if (current.length) {
            sheets.push({ name: `Sheet${sheets.length + 1}`, rows: current });
            current = [];
        }
    };
    for (const line of md.split(/\r?\n/)) {
        const t = line.trim();
        if (/^\|.*\|$/.test(t)) {
            const cells = t.slice(1, -1).split('|').map((c) => c.trim());
            if (!cells.every((c) => /^:?-{2,}:?$/.test(c)))
                current.push(cells.map(coerceCell));
        }
        else {
            flush();
        }
    }
    flush();
    if (!sheets.length)
        throw new Error('markdown 中未找到表格（需 | 列 | 列 | 格式）');
    return sheets;
}
function parseSlidesArg(v) {
    const arr = parseArrayArg(v, 'slides');
    return arr.map((s) => ({
        title: s?.title != null ? String(s.title) : undefined,
        subtitle: s?.subtitle != null ? String(s.subtitle) : undefined,
        bullets: Array.isArray(s?.bullets) ? s.bullets.map((b) => String(b)) : undefined,
        text: s?.text != null ? String(s.text) : undefined,
        layout: s?.layout,
        notes: s?.notes != null ? String(s.notes) : undefined
    }));
}
// ── office_convert：格式互转引擎链 ──────────────
/** 规范化格式名 */
function normFmt(f) {
    const t = f.toLowerCase().trim().replace(/^\./, '');
    if (t === 'markdown')
        return 'md';
    if (t === 'htm')
        return 'html';
    return t;
}
/** 默认输出路径：同目录同名换扩展名 */
function defaultOutPath(inputPath, target) {
    const dir = path_1.default.dirname(inputPath);
    const base = path_1.default.basename(inputPath, path_1.default.extname(inputPath));
    return path_1.default.join(dir, `${base}.${target}`);
}
/** SheetJS：xlsx/xls/xlsm → csv（首个工作表，BOM 防 Excel 乱码）/ json（全部工作表） */
async function sheetToCsvJson(inputPath, outPath, target) {
    const wb = XLSX.readFile(inputPath);
    if (target === 'csv') {
        const name = wb.SheetNames[0];
        if (!name)
            throw new Error('工作簿为空');
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        await fs_1.promises.writeFile(outPath, '\ufeff' + csv, 'utf-8');
        return wb.SheetNames.length > 1
            ? `已导出 CSV（首个工作表「${name}」，共 ${wb.SheetNames.length} 表，全部数据可用 json 目标）: ${outPath}`
            : `已导出 CSV: ${outPath}`;
    }
    const data = {};
    for (const n of wb.SheetNames) {
        data[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });
    }
    await fs_1.promises.writeFile(outPath, JSON.stringify(data, null, 2), 'utf-8');
    return `已导出 JSON（${wb.SheetNames.length} 个工作表）: ${outPath}`;
}
/** SheetJS：csv / json → xlsx */
async function csvJsonToXlsx(inputPath, outPath, src) {
    if (src === 'csv') {
        const content = (await fs_1.promises.readFile(inputPath, 'utf-8')).replace(/^\ufeff/, '');
        const wb = XLSX.read(content, { type: 'string' });
        XLSX.writeFile(wb, outPath);
        return;
    }
    const data = JSON.parse(await fs_1.promises.readFile(inputPath, 'utf-8'));
    const wb = XLSX.utils.book_new();
    if (Array.isArray(data)) {
        const rows = data.map((r) => (Array.isArray(r) ? r.map(coerceCell) : [coerceCell(r)]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    }
    else if (data && typeof data === 'object') {
        let i = 0;
        for (const [name, rows] of Object.entries(data)) {
            if (!Array.isArray(rows))
                continue;
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.map((r) => (Array.isArray(r) ? r.map(coerceCell) : [coerceCell(r)]))), String(name).slice(0, 31) || `Sheet${++i}`);
            i++;
        }
    }
    else {
        throw new Error('json 结构不支持：需为二维数组或 {表名: 二维数组}');
    }
    XLSX.writeFile(wb, outPath);
}
/** pandoc 通用转换（txt 源用 markdown reader，txt 目标用 plain writer） */
function pandocConvert(inputPath, from, to, outPath) {
    const fromFmt = from === 'md' || from === 'txt' ? 'gfm' : from;
    const toFmt = to === 'md' ? 'gfm' : to;
    const r = (0, child_process_1.spawnSync)('pandoc', ['-f', fromFmt, '-t', toFmt, '-o', outPath, inputPath], { timeout: 60000, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) {
        throw new Error(`pandoc 转换失败: ${((r.stderr || r.stdout) || `退出码 ${r.status}`).trim()}`);
    }
}
/** LibreOffice headless：转换到指定格式，产物重命名到 outPath */
async function sofficeConvert(inputPath, outPath, sofficeCmd, targetFmt) {
    const outDir = path_1.default.dirname(outPath);
    const r = (0, child_process_1.spawnSync)(sofficeCmd, ['--headless', '--convert-to', targetFmt, '--outdir', outDir, inputPath], { timeout: 120000, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) {
        throw new Error(`LibreOffice 转换失败: ${((r.stderr || r.stdout) || `退出码 ${r.status}`).trim()}`);
    }
    const auto = path_1.default.join(outDir, path_1.default.basename(inputPath, path_1.default.extname(inputPath)) + '.' + targetFmt);
    if (path_1.default.resolve(auto) !== path_1.default.resolve(outPath)) {
        await fs_1.promises.rename(auto, outPath).catch(async () => {
            await fs_1.promises.copyFile(auto, outPath);
            await fs_1.promises.unlink(auto).catch(() => { });
        });
    }
    await fs_1.promises.access(outPath);
}
/** MS Office COM：导出 pdf（Word 17 / Excel ExportAsFixedFormat 0 / PowerPoint 32） */
async function comExportToPdf(inputPath, outPath) {
    const ext = path_1.default.extname(inputPath).toLowerCase();
    const open = (0, powershell_1.psQuote)(inputPath);
    const out = (0, powershell_1.psQuote)(outPath);
    let script;
    if (ext === '.docx' || ext === '.doc') {
        script = [
            "$ErrorActionPreference = 'Stop'",
            'try {',
            '  $app = New-Object -ComObject Word.Application',
            '  $app.Visible = $false',
            '  $app.DisplayAlerts = 0',
            `  $doc = $app.Documents.Open(${open}, $false, $true)`,
            `  $doc.SaveAs2(${out}, 17)`,
            '  $doc.Close($false)',
            '  $app.Quit()',
            "  Write-Output 'OK'",
            '} catch {',
            "  Write-Output ('FAIL: ' + $_.Exception.Message)",
            '  try { $app.Quit() } catch {}',
            '}'
        ].join('\n');
    }
    else if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
        script = [
            "$ErrorActionPreference = 'Stop'",
            'try {',
            '  $app = New-Object -ComObject Excel.Application',
            '  $app.Visible = $false',
            '  $app.DisplayAlerts = 0',
            `  $wb = $app.Workbooks.Open(${open}, 0, $true)`,
            `  $wb.ExportAsFixedFormat(0, ${out})`,
            '  $wb.Close($false)',
            '  $app.Quit()',
            "  Write-Output 'OK'",
            '} catch {',
            "  Write-Output ('FAIL: ' + $_.Exception.Message)",
            '  try { $app.Quit() } catch {}',
            '}'
        ].join('\n');
    }
    else if (ext === '.pptx' || ext === '.ppt') {
        script = [
            "$ErrorActionPreference = 'Stop'",
            'try {',
            '  $app = New-Object -ComObject PowerPoint.Application',
            `  $pres = $app.Presentations.Open(${open}, $true, $false, $false)`,
            `  $pres.SaveAs(${out}, 32)`,
            '  $pres.Close()',
            '  $app.Quit()',
            "  Write-Output 'OK'",
            '} catch {',
            "  Write-Output ('FAIL: ' + $_.Exception.Message)",
            '  try { $app.Quit() } catch {}',
            '}'
        ].join('\n');
    }
    else {
        throw new Error(`Office COM 不支持该源格式转 pdf: ${ext}`);
    }
    const r = await (0, powershell_1.runPowerShell)(script, 120000);
    const text = (r.stdout + r.stderr).trim();
    if (r.code !== 0 || text.includes('FAIL')) {
        throw new Error(`Office COM 转换失败: ${text.match(/FAIL: (.*)/)?.[1] || text.slice(0, 300)}`);
    }
    await fs_1.promises.access(outPath);
}
/** Word COM：.doc → .docx（wdFormatXMLDocument=16） */
async function comDocToDocx(inputPath, outPath) {
    const script = [
        "$ErrorActionPreference = 'Stop'",
        'try {',
        '  $app = New-Object -ComObject Word.Application',
        '  $app.Visible = $false',
        '  $app.DisplayAlerts = 0',
        `  $doc = $app.Documents.Open(${(0, powershell_1.psQuote)(inputPath)}, $false, $true)`,
        `  $doc.SaveAs2(${(0, powershell_1.psQuote)(outPath)}, 16)`,
        '  $doc.Close($false)',
        '  $app.Quit()',
        "  Write-Output 'OK'",
        '} catch {',
        "  Write-Output ('FAIL: ' + $_.Exception.Message)",
        '  try { $app.Quit() } catch {}',
        '}'
    ].join('\n');
    const r = await (0, powershell_1.runPowerShell)(script, 120000);
    const text = (r.stdout + r.stderr).trim();
    if (r.code !== 0 || text.includes('FAIL')) {
        throw new Error(`Word COM 转换失败: ${text.match(/FAIL: (.*)/)?.[1] || text.slice(0, 300)}`);
    }
    await fs_1.promises.access(outPath);
}
// ── 工具定义 ──────────────────────────────────────
exports.officeTools = [
    {
        schema: {
            name: 'markdown_to_docx',
            description: '把 Markdown 文本转换为 Word (.docx)。支持 # 标题、- / 1. 列表、| 表格 |、--- 分页，' +
                '以及 $$块级$$ / $行内$ LaTeX 数学公式（自动插入为 Word 原生可编辑公式）。' +
                '检测到 pandoc 时优先用 pandoc 引擎（表格样式更成熟），否则用内置纯 JS 引擎（零依赖）；' +
                'font_name / font_size / landscape 参数仅内置引擎生效。',
            parameters: {
                type: 'object',
                properties: {
                    save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\报告.docx' },
                    markdown: { type: 'string', description: 'Markdown 文本内容' },
                    title: { type: 'string', description: '文档标题属性（可选）' },
                    author: { type: 'string', description: '作者（可选）' },
                    font_name: { type: 'string', description: '正文字体（仅内置引擎），默认 等线' },
                    font_size: { type: 'number', description: '正文字号/磅（仅内置引擎），默认 11' },
                    landscape: { type: 'boolean', description: '是否横向页面（仅内置引擎），默认 false' }
                },
                required: ['save_path', 'markdown']
            }
        },
        async run(a) {
            const md = (0, types_1.str)(a.markdown);
            if (!md.trim())
                throw new Error('markdown 内容为空');
            const final = resolveSavePath((0, types_1.str)(a.save_path), '.docx');
            await ensureParentDir(final);
            const caps = (0, capabilities_1.getCapabilities)();
            if (caps.pandoc) {
                try {
                    await pandocToDocx(md, final, { title: a.title ? (0, types_1.str)(a.title) : undefined, author: a.author ? (0, types_1.str)(a.author) : undefined });
                    return `已由 Markdown 生成 Word 文档（pandoc 引擎）: ${final}`;
                }
                catch (e) {
                    Logger_1.Logger.warn(`[markdown_to_docx] pandoc 转换失败，回退内置引擎: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            await (0, DocxBuilder_1.ensureMathEngines)();
            const blocks = markdownToBlocks(md);
            if (!blocks.length)
                throw new Error('未解析到任何内容块');
            const buf = await (0, DocxBuilder_1.buildDocx)(blocks, buildOpts(a));
            await fs_1.promises.writeFile(final, buf);
            return `已由 Markdown 生成 Word 文档（内置 JS 引擎）: ${final}\n块数: ${blocks.length}，大小: ${buf.length} 字节`;
        }
    },
    {
        schema: {
            name: 'write_xlsx',
            description: '创建 Excel (.xlsx)。两种输入二选一：sheets = [{name?, rows: [[..], [..]]}] JSON 数组（精确控制），' +
                '或 markdown = Markdown 表格文本（每个连续表格块生成一张工作表）。数字字符串自动转数字。',
            parameters: {
                type: 'object',
                properties: {
                    save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\数据.xlsx' },
                    sheets: { type: 'array', description: '工作表数组，每项 {name?, rows: 二维数组}', items: { type: 'object' } },
                    markdown: { type: 'string', description: 'Markdown 表格文本（与 sheets 二选一）' }
                },
                required: ['save_path']
            }
        },
        async run(a) {
            const sheets = a.sheets !== undefined && a.sheets !== null && a.sheets !== ''
                ? parseSheetsArg(a.sheets)
                : a.markdown !== undefined && a.markdown !== null && (0, types_1.str)(a.markdown).trim() !== ''
                    ? markdownToSheets((0, types_1.str)(a.markdown))
                    : null;
            if (!sheets || !sheets.length)
                throw new Error('需提供 sheets（JSON 数组）或 markdown（表格文本）之一');
            const wb = XLSX.utils.book_new();
            for (const s of sheets) {
                const ws = XLSX.utils.aoa_to_sheet(s.rows);
                XLSX.utils.book_append_sheet(wb, ws, s.name);
            }
            const final = resolveSavePath((0, types_1.str)(a.save_path), '.xlsx');
            await ensureParentDir(final);
            XLSX.writeFile(wb, final);
            const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0);
            return `已生成 Excel: ${final}\n工作表 ${sheets.length} 个（${sheets.map((s) => s.name).join(', ')}），共 ${totalRows} 行`;
        }
    },
    {
        schema: {
            name: 'write_pptx',
            description: '创建 PowerPoint (.pptx) 演示文稿（16:9）。slides 为 JSON 数组，每项：' +
                '{title, subtitle?, bullets?: string[], text?, layout?, notes?}；' +
                'layout 可为 title（封面页：大标题+副标题）/ titleContent（默认：标题+要点列表）/ twoContent（标题+双栏要点）；' +
                'notes 为演讲者备注。',
            parameters: {
                type: 'object',
                properties: {
                    save_path: { type: 'string', description: '保存路径，如 C:\\Users\\me\\Desktop\\演示.pptx' },
                    slides: { type: 'array', description: '幻灯片数组，每项 {title, subtitle?, bullets?, text?, layout?, notes?}', items: { type: 'object' } },
                    title: { type: 'string', description: '演示文稿标题属性（可选）' },
                    author: { type: 'string', description: '作者（可选）' }
                },
                required: ['save_path', 'slides']
            }
        },
        async run(a) {
            const slides = parseSlidesArg(a.slides);
            if (!slides.length)
                throw new Error('slides 为空');
            const pptx = new pptxgenjs_1.default();
            pptx.layout = 'LAYOUT_16x9';
            if (a.title)
                pptx.title = (0, types_1.str)(a.title);
            if (a.author)
                pptx.author = (0, types_1.str)(a.author);
            for (const s of slides) {
                const slide = pptx.addSlide();
                if (s.notes)
                    slide.addNotes(s.notes);
                const layout = s.layout || (s.bullets || s.text ? 'titleContent' : 'title');
                if (layout === 'title') {
                    slide.addText(s.title || '', { x: 0.5, y: 1.9, w: 9, h: 1.2, fontSize: 40, bold: true, align: 'center', color: '1F3864' });
                    if (s.subtitle) {
                        slide.addText(s.subtitle, { x: 0.5, y: 3.3, w: 9, h: 0.8, fontSize: 20, align: 'center', color: '595959' });
                    }
                }
                else if (layout === 'twoContent') {
                    slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 28, bold: true, color: '1F3864' });
                    const items = s.bullets || [];
                    const half = Math.ceil(items.length / 2);
                    const mk = (arr) => arr.map((t) => ({ text: t, options: { bullet: true } }));
                    if (half > 0)
                        slide.addText(mk(items.slice(0, half)), { x: 0.5, y: 1.35, w: 4.4, h: 3.9, fontSize: 16, valign: 'top' });
                    if (items.length - half > 0)
                        slide.addText(mk(items.slice(half)), { x: 5.1, y: 1.35, w: 4.4, h: 3.9, fontSize: 16, valign: 'top' });
                }
                else {
                    slide.addText(s.title || '', { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 28, bold: true, color: '1F3864' });
                    if (s.bullets && s.bullets.length) {
                        slide.addText(s.bullets.map((t) => ({ text: t, options: { bullet: true } })), { x: 0.5, y: 1.35, w: 9, h: 3.9, fontSize: 16, valign: 'top' });
                    }
                    else if (s.text) {
                        slide.addText(s.text, { x: 0.5, y: 1.35, w: 9, h: 3.9, fontSize: 16, valign: 'top' });
                    }
                }
            }
            const final = resolveSavePath((0, types_1.str)(a.save_path), '.pptx');
            await ensureParentDir(final);
            const buf = (await pptx.write({ outputType: 'nodebuffer' }));
            await fs_1.promises.writeFile(final, buf);
            return `已生成 PowerPoint: ${final}\n页数: ${slides.length}，大小: ${buf.length} 字节`;
        }
    },
    {
        schema: {
            name: 'office_convert',
            description: '本地文档格式互转。支持：xlsx/xls/xlsm → csv/json、csv/json → xlsx、xls/xlsm → xlsx（纯 JS 恒可用）；' +
                'md ↔ docx ↔ html ↔ txt 互转（需 pandoc）；Office 文档 → pdf（docx/doc/xlsx/xls/pptx/ppt/md/html/txt，需 LibreOffice 或 MS Office，按能力探测自动选择；md/html/txt 走先转 docx 再转 pdf 组合链）；.doc → .docx。' +
                '引擎降级链：纯 JS → pandoc → LibreOffice → Office COM；不可达时报错并给出安装指引。',
            parameters: {
                type: 'object',
                properties: {
                    input_path: { type: 'string', description: '输入文件绝对路径' },
                    target_format: { type: 'string', description: '目标格式：pdf / docx / md / html / txt / xlsx / csv / json' },
                    output_path: { type: 'string', description: '输出路径（可选，默认同目录同名换扩展名）' }
                },
                required: ['input_path', 'target_format']
            }
        },
        async run(a) {
            const inputPath = path_1.default.resolve((0, types_1.str)(a.input_path));
            const target = normFmt((0, types_1.str)(a.target_format));
            if (!inputPath || !target)
                throw new Error('需提供 input_path 与 target_format');
            await fs_1.promises.access(inputPath);
            const srcExt = path_1.default.extname(inputPath).toLowerCase().slice(1);
            if (!srcExt)
                throw new Error('输入文件缺少扩展名');
            const src = normFmt(srcExt);
            if (src === target)
                throw new Error(`源格式与目标格式相同（${src}）`);
            const outPath = a.output_path ? resolveSavePath((0, types_1.str)(a.output_path), '.' + target) : defaultOutPath(inputPath, target);
            await ensureParentDir(outPath);
            const caps = (0, capabilities_1.getCapabilities)();
            // 1) 纯 JS：表格互转（SheetJS，零依赖恒可用）
            if ((src === 'xlsx' || src === 'xls' || src === 'xlsm') && (target === 'csv' || target === 'json')) {
                return await sheetToCsvJson(inputPath, outPath, target);
            }
            if ((src === 'csv' || src === 'json') && target === 'xlsx') {
                await csvJsonToXlsx(inputPath, outPath, src);
                return `已转换（SheetJS）: ${outPath}`;
            }
            if ((src === 'xls' || src === 'xlsm') && target === 'xlsx') {
                XLSX.writeFile(XLSX.readFile(inputPath), outPath);
                return `已转换（SheetJS）: ${outPath}`;
            }
            // 2) md → docx：pandoc 优先，内置 JS 引擎兑底
            if (src === 'md' && target === 'docx') {
                if (caps.pandoc) {
                    pandocConvert(inputPath, 'md', 'docx', outPath);
                    return `已转换（pandoc）: ${outPath}`;
                }
                const md = await fs_1.promises.readFile(inputPath, 'utf-8');
                await (0, DocxBuilder_1.ensureMathEngines)();
                await fs_1.promises.writeFile(outPath, await (0, DocxBuilder_1.buildDocx)(markdownToBlocks(md), {}));
                return `已转换（内置 JS 引擎）: ${outPath}`;
            }
            // 3) pandoc 文档互转：md/docx/html/txt
            const PANDOC_FMTS = ['md', 'docx', 'html', 'txt'];
            if (PANDOC_FMTS.includes(src) && PANDOC_FMTS.includes(target)) {
                if (!caps.pandoc) {
                    throw new Error(`当前转换（${src} → ${target}）需要 pandoc，未检测到。安装后重试：https://pandoc.org/installing.html`);
                }
                pandocConvert(inputPath, src, target, outPath);
                return `已转换（pandoc）: ${outPath}`;
            }
            // 4) .doc → .docx：LibreOffice 优先，Word COM 兑底
            if (src === 'doc' && target === 'docx') {
                if (caps.sofficeCmd) {
                    await sofficeConvert(inputPath, outPath, caps.sofficeCmd, 'docx');
                    return `已转换（LibreOffice）: ${outPath}`;
                }
                if (caps.officeCom) {
                    await comDocToDocx(inputPath, outPath);
                    return `已转换（Word COM）: ${outPath}`;
                }
                throw new Error('.doc → .docx 需要 LibreOffice 或 MS Office，本机均未检测到');
            }
            // 5) pdf 输出：md/html/txt 先转 docx 再转 pdf（组合链）
            if (target === 'pdf') {
                let actualInput = inputPath;
                const tmpDocx = path_1.default.join(os_1.default.tmpdir(), `wa-conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.docx`);
                try {
                    if (src === 'md' || src === 'html' || src === 'txt') {
                        if (src === 'md' && !caps.pandoc) {
                            const md = await fs_1.promises.readFile(inputPath, 'utf-8');
                            await (0, DocxBuilder_1.ensureMathEngines)();
                            await fs_1.promises.writeFile(tmpDocx, await (0, DocxBuilder_1.buildDocx)(markdownToBlocks(md), {}));
                        }
                        else {
                            if (!caps.pandoc)
                                throw new Error(`${src} → pdf 需先转 docx，该步需要 pandoc（未检测到）。安装：https://pandoc.org/installing.html`);
                            pandocConvert(inputPath, src, 'docx', tmpDocx);
                        }
                        actualInput = tmpDocx;
                    }
                    if (caps.sofficeCmd) {
                        await sofficeConvert(actualInput, outPath, caps.sofficeCmd, 'pdf');
                        return `已转换为 PDF（LibreOffice 引擎${actualInput !== inputPath ? '，源文件先转 docx 组合链' : ''}）: ${outPath}`;
                    }
                    if (caps.officeCom) {
                        await comExportToPdf(actualInput, outPath);
                        return `已转换为 PDF（MS Office COM 引擎${actualInput !== inputPath ? '，源文件先转 docx 组合链' : ''}）: ${outPath}`;
                    }
                    throw new Error('PDF 输出需要 LibreOffice（soffice）或 MS Office，本机均未检测到。安装其一后重试。');
                }
                finally {
                    if (actualInput === tmpDocx)
                        await fs_1.promises.unlink(tmpDocx).catch(() => { });
                }
            }
            throw new Error(`不支持的转换对: ${src} → ${target}。支持：xlsx/xls/xlsm ↔ csv/json、xls/xlsm → xlsx、md ↔ docx ↔ html ↔ txt（需 pandoc）、→ pdf（需 LibreOffice/Office）、doc → docx。` +
                '生成新文档请用 markdown_to_docx / write_xlsx / write_pptx。');
        }
    }
];
