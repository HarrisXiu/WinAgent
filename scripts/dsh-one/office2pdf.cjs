'use strict';
const path = require('node:path');
const { runJsonProcess } = require('./runtime.cjs');

const optionProperties = {
  engine: { type: 'string', enum: ['auto', 'office', 'wps'], description: '转换引擎；auto 优先 Office，回退 WPS' },
  naming_tpl: { type: 'string', description: '文件名模板，默认 {name}；支持 {seq}/{sheet}/{pseq}/{date:yyyy-mm-dd}' },
  blank_page_action: { type: 'string', enum: ['keep', 'remove'], description: '保留或保守移除空白页' },
  wm1_text: { type: 'string', description: '第一层水印文字' },
  wm1_pos: { type: 'string', enum: ['None', 'diag', 'large', 'tl', 'tc', 'tr', 'bl', 'bc', 'br'], description: '水印位置：None/diag/large/tl/tc/tr/bl/bc/br' },
  wm2_text: { type: 'string', description: '第二层水印文字' },
  wm2_pos: { type: 'string', enum: ['None', 'diag', 'large', 'tl', 'tc', 'tr', 'bl', 'bc', 'br'], description: '第二层水印位置' },
  wm_font: { type: 'string', description: '字体名称' },
  wm_size: { type: 'integer', description: '水印字号，10–300' },
  wm_color: { type: 'string', description: '水印颜色，#RRGGBB' },
  wm_alpha: { type: 'number', description: '水印不透明度，0–1' },
  pg_enabled: { type: 'boolean', description: '添加页码' },
  pg_pos: { type: 'string', enum: ['bc', 'br'], description: '页码位置' },
  pg_format: { type: 'string', description: '页码格式，默认 - {n} / {total} -' },
  password: { type: 'string', description: '输出 PDF 密码' },
};
for (const [name, description] of Object.entries({
  merge_all: '合并全部输入', split_word_page: 'Word 按页拆分', split_ppt_page: 'PPT 按页拆分',
  split_pdf_page: 'PDF 按页拆分', split_excel_sheet: 'Excel 按工作表拆分', split_excel_page: 'Excel 按页拆分',
  excel_fit: 'Excel 适配一页宽', excel_fit_tall: 'Excel 适配一页高',
  compress_pdf: '压缩内容流', clear_metadata: '清除元数据',
})) optionProperties[name] = { type: 'boolean', description };

exports.create = function (config) {
  const command = config.pythonPath || 'python';
  const call = (input, exec) => runJsonProcess(command, [path.join(__dirname, '../python/bridge.py')], input,
    { signal: exec?.signal, timeoutMs: config.timeoutMs ?? 600000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const tools = [{
    schema: {
      name: 'office2pdf_convert',
      description: 'office2PDF 批量转换：Word/Excel/PPT（Office 或 WPS）、PDF、PNG/JPEG → PDF。支持范围、合并/拆分、双水印、页码、密码、压缩、元数据与空白页处理。逐个返回成功/失败状态与所有输出路径，已存在文件自动加序号。',
      parameters: { type: 'object', properties: {
        files: { type: 'array', description: '按顺序处理的输入文件', items: { type: 'object', properties: {
          path: { type: 'string', description: '输入文件绝对路径' },
          range: { type: 'string', description: 'Word/PPT/PDF 页码如 1-3,5；Excel 为工作表范围，空表示全部' },
        }, required: ['path'] } },
        output_dir: { type: 'string', description: '输出目录绝对路径，必须指定' },
        options: { type: 'object', properties: optionProperties, additionalProperties: false, description: '转换选项；默认不自动打开文件、不覆盖已有文件' },
      }, required: ['files', 'output_dir'] },
    }, dangerous: true,
    run: async (a, exec) => JSON.stringify(await call({ ...a, action: 'convert' }, exec)),
  }, {
    schema: { name: 'office2pdf_inspect', description: '检查 Python 依赖与 Office/WPS COM 注册情况，可列出 Excel 工作表。', parameters: { type: 'object', properties: {
      path: { type: 'string', description: '可选 Excel 文件绝对路径' },
      engine: optionProperties.engine,
    } } },
    run: async (a, exec) => JSON.stringify(await call({ ...a, action: 'inspect' }, exec)),
  }];
  return { tools, dispose() {} };
};
