'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const bundles = path.join(root, 'dsh-one');
const inventory = require('../dsh-one/plugins.json');
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'winagent-dsh-test-'));
process.env.WINAGENT_DATA_DIR = path.join(temp, 'data');
const { makePdf } = require('./pdf-fixture.cjs');
const runtime = require('../dsh-one/dsh-winagent-files/lib/runtime.cjs');

function context() {
  const registered = new Map(), events = new Map(), effects = [];
  const images = [];
  return {
    registered, events, effects, images,
    tools: { register(tool) {
      assert(!registered.has(tool.name), `重复工具 ${tool.name}`);
      registered.set(tool.name, tool);
      return () => registered.delete(tool.name);
    } },
    on(event, handler) { events.set(event, [...events.get(event) || [], handler]); return () => {
      events.set(event, events.get(event).filter(h => h !== handler));
    }; },
    effect(create) { effects.push(create()); },
    get(service) { return service === 'attachments' ? { async saveImages(inputs) {
      images.push(...inputs);
      return inputs.map((im, i) => ({ attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: im.mediaType,
        width: 2, height: 2, bytes: im.data.length, name: `image-${i}.png` }));
    } } : undefined; },
    dispose() { for (const dispose of effects.reverse()) dispose(); },
  };
}
async function activate(id, config = {}) {
  const ctx = context();
  const plugin = require(path.join(bundles, `dsh-winagent-${id}/lib/index.js`));
  assert.deepEqual(plugin.inject, ['tools']);
  await plugin.apply(ctx, config);
  return ctx;
}
async function call(ctx, name, args) {
  const tool = ctx.registered.get('winagent_' + name);
  assert(tool, `工具缺失 ${name}`);
  return tool.execute(args, { signal: new AbortController().signal });
}
const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'const', 'description', 'title', 'default', 'examples']);
function checkSchema(schema) {
  for (const key of Object.keys(schema)) assert(allowed.has(key), 'DSH 不支持的 schema 字段：' + key);
  for (const value of Object.values(schema.properties || {})) checkSchema(value);
  if (schema.items) checkSchema(schema.items);
  for (const item of schema.oneOf || []) checkSchema(item);
  for (const name of schema.required || []) assert(name in schema.properties, 'required 字段不存在：' + name);
}

test('所有独立包注册、清单与 DSH schema 合约一致，并能完整卸载', async () => {
  for (const entry of inventory) {
    const ctx = await activate(entry.id);
    try {
      assert.deepEqual([...ctx.registered.keys()].sort(), [...entry.tools].sort(), entry.package);
      for (const tool of ctx.registered.values()) {
        checkSchema(tool.parameters); checkSchema(tool.output.schema);
        assert.equal(tool.isConcurrencySafe({}), false);
        assert.equal(tool.output.schema.type, 'string');
      }
      const pkg = require(path.join(bundles, entry.package, 'package.json'));
      assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
      assert((await fs.readFile(path.join(bundles, entry.package, 'cordis.patch.yml'), 'utf8')).includes(`name: ${pkg.name}`));
    } finally { ctx.dispose(); }
    assert.equal(ctx.registered.size, 0);
  }
});

test('覆盖 WinAgent 原有全部工具/skills，跨包不重名', async () => {
  const originals = [];
  for (const group of ['file', 'system', 'registry', 'input', 'window', 'http', 'office']) {
    const lib = require(`../dsh-plugin/lib/tools/${group}Tools.js`);
    originals.push(...lib[`${group}Tools`].map(t => 'winagent_' + t.schema.name));
  }
  const ctx = await activate('wiki');
  originals.push(...[...ctx.registered.keys()].filter(n => !/import_knowledge/.test(n)));
  ctx.dispose();
  originals.push('winagent_speak_text');
  const matter = require('gray-matter');
  for (const dir of await fs.readdir(path.join(root, 'dsh-plugin/assets/skills'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const p = path.join(root, 'dsh-plugin/assets/skills', dir.name);
    const meta = fsSync.existsSync(path.join(p, 'manifest.json')) ? JSON.parse(await fs.readFile(path.join(p, 'manifest.json')))
      : matter(await fs.readFile(path.join(p, 'SKILL.md'), 'utf8')).data;
    originals.push('winagent_' + meta.name);
  }
  const migrated = inventory.flatMap(g => g.tools);
  assert.equal(new Set(migrated).size, migrated.length);
  assert.equal(originals.length, 62);
  assert.equal(migrated.length, 68);
  for (const name of originals) assert(migrated.includes(name), name);
});

test('审批接入：危险操作 ask，保留既有 deny/ask，普通读取 allow', async () => {
  const ctx = await activate('files');
  try {
    const gate = ctx.events.get('tools/pre-execute')[0];
    assert.equal((await gate({ name: 'winagent_delete_file' }, async () => ({ kind: 'allow' }))).kind, 'ask');
    const denied = { kind: 'deny', reason: '既有策略拒绝' };
    assert.equal(await gate({ name: 'winagent_delete_file' }, async () => denied), denied);
    const ask = { kind: 'ask', reason: '既有审批' };
    assert.equal(await gate({ name: 'winagent_delete_file' }, async () => ask), ask);
    assert.equal((await gate({ name: 'winagent_read_file' }, async () => ({ kind: 'allow' }))).kind, 'allow');
  } finally { ctx.dispose(); }
});

test('禁用插件与注册失败回滚', async () => {
  const ctx = await activate('files', { enabled: false });
  assert.equal(ctx.registered.size, 0);
  const broken = context(); let count = 0;
  const register = broken.tools.register;
  broken.tools.register = tool => { if (++count === 2) throw new Error('故意注册失败'); return register(tool); };
  await assert.rejects(require('../dsh-one/dsh-winagent-files/lib/index.js').apply(broken), /故意/);
  assert.equal(broken.registered.size, 0);
  assert.equal(broken.events.get('tools/pre-execute').length, 0);
});

test('文件工具能真实读写，取消调用不会写文件', async () => {
  const ctx = await activate('files');
  try {
    const target = path.join(temp, '你好.txt');
    await call(ctx, 'write_file', { path: target, content: 'DSH migration 你好' });
    assert((await call(ctx, 'read_file', { path: target })).includes('DSH migration 你好'));
    const cancel = new AbortController(); cancel.abort();
    const cancelled = path.join(temp, 'cancelled.txt');
    await assert.rejects(ctx.registered.get('winagent_write_file').execute({ path: cancelled, content: 'bad' }, { signal: cancel.signal }));
    assert(!fsSync.existsSync(cancelled));
  } finally { ctx.dispose(); }
});

test('独立 Office 生成与读取 DOCX/XLSX/PPTX，无 PDF 分类依赖', async () => {
  const caps = require('../dsh-one/dsh-winagent-office/lib/util/capabilities');
  const probe = caps.getCapabilities;
  caps.getCapabilities = () => ({ pandoc: null, sofficeCmd: null, officeCom: false });
  const ctx = await activate('office');
  try {
    const docx = path.join(temp, '中文文档.docx'), xlsx = path.join(temp, '数据.xlsx'), pptx = path.join(temp, '演示.pptx');
    await call(ctx, 'markdown_to_docx', { save_path: docx, markdown: '# Migration\n中文文档\n\n$x^2 + y^2$' });
    const zip = await require('jszip').loadAsync(await fs.readFile(docx));
    assert((await zip.file('word/document.xml').async('string')).includes('m:oMath'));
    assert(JSON.parse(await call(ctx, 'read_docx', { path: docx })).text.includes('Migration'));
    await call(ctx, 'write_xlsx', { save_path: xlsx, sheets: [{ name: 'Data', rows: [['name', 'value'], ['hello', 42]] }] });
    assert((await call(ctx, 'read_xlsx', { path: xlsx })).includes('hello'));
    await call(ctx, 'write_pptx', { save_path: pptx, slides: [{ title: 'Migration', bullets: ['独立插件'] }] });
    assert((await call(ctx, 'read_pptx', { path: pptx })).includes('Migration'));
    const csv = path.join(temp, 'table.csv');
    await call(ctx, 'office_convert', { input_path: xlsx, target_format: 'csv', output_path: csv });
    assert((await fs.readFile(csv, 'utf8')).includes('hello,42'));
  } finally { ctx.dispose(); caps.getCapabilities = probe; }
});

test('PDF 文本、页面渲染与 DSH 持久化附件输出', async () => {
  const ctx = await activate('pdf');
  try {
    const input = path.join(temp, 'sample.pdf');
    await fs.writeFile(input, makePdf());
    assert(JSON.parse(await call(ctx, 'read_pdf', { path: input })).text.length > 0);
    const result = await call(ctx, 'render_pdf_page', { path: input, pages: '1', scale: 0.5 });
    const blocks = ctx.registered.get('winagent_render_pdf_page').output.render({}, result);
    assert.equal(blocks[1].type, 'image');
    assert.equal(blocks[1].attachment.mediaType, 'image/png');
    assert.equal(ctx.images.length, 1);
    assert(ctx.images[0].data.length > 100);
    const metadata = await call(ctx, 'extract_pdf_images', { path: input });
    assert(!metadata.includes('[[IMG:'));
  } finally { ctx.dispose(); }
});

test('图像返回使用 DSH attachments 服务，缺失服务明确报错', async () => {
  const ctx = context();
  const converted = await runtime.admitImages(ctx, 'meta\n[[IMG:data:image/png;base64,YWJj]]');
  assert(!converted.includes('YWJj'));
  const blocks = runtime.render({}, converted);
  assert.equal(blocks[0].text, 'meta');
  assert.equal(blocks[1].type, 'image');
  assert.equal(blocks[1].attachment.mediaType, 'image/png');
  await assert.rejects(runtime.admitImages({ get() {} }, '[[IMG:image/png;base64,YWJj]]'), /attachments/);
});

test('扩展加载器运行 hello 和外部 SKILL.md', async () => {
  const directory = path.join(temp, 'external/custom');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'SKILL.md'), '---\nname: external_instruction\ndescription: 外部指令\n---\n请遵循外部规则。');
  const ctx = await activate('extensions', { skillsDirs: [path.dirname(directory)] });
  try {
    assert((await call(ctx, 'hello_skill', { name: 'DSH' })).includes('DSH'));
    assert((await call(ctx, 'external_instruction', {})).includes('外部规则'));
  } finally { ctx.dispose(); }
});

test('MCP HTTP 工具挂载、调用、名称前缀和审批均可用', async () => {
  const server = require('node:http').createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    const result = message.method === 'notifications/initialized' ? {}
      : message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } }
      : message.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'MCP echo', inputSchema: {
        type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
      } }] } : { content: [{ type: 'text', text: message.params.arguments.text }] };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let ctx;
  try {
    const configPath = path.join(temp, 'mcp.json');
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${server.address().port}` } } }));
    ctx = await activate('extensions', { mcpConfigPath: configPath });
    assert((await call(ctx, 'mcp__fixture__echo', { text: 'MCP works' })).includes('MCP works'));
    const gate = ctx.events.get('tools/pre-execute')[0];
    assert.equal((await gate({ name: 'winagent_mcp__fixture__echo' }, async () => ({ kind: 'allow' }))).kind, 'ask');
  } finally { ctx?.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('office2PDF bridge PDF/图片合并、水印、加密及不覆盖原有文件', async t => {
  const python = process.env.DSH_OFFICE2PDF_TEST_PYTHON;
  if (!python) { t.skip('设置 DSH_OFFICE2PDF_TEST_PYTHON 后进行 Python 实际转换验证'); return; }
  const input = path.join(temp, 'office2pdf-input.pdf');
  await fs.writeFile(input, makePdf());
  const output = path.join(temp, 'pdf-output');
  const ctx = await activate('office2pdf', { pythonPath: python });
  try {
    const result = JSON.parse(await call(ctx, 'office2pdf_convert', {
      files: [{ path: input, range: '1' }], output_dir: output,
      options: { wm1_text: 'DSH', wm1_pos: 'diag', pg_enabled: true, password: 'test-secret', clear_metadata: true },
    }));
    assert.equal(result.ok, true, JSON.stringify(result.logs));
    assert.equal(result.outputs.length, 1);
    const previous = await fs.readFile(result.outputs[0]);
    const second = JSON.parse(await call(ctx, 'office2pdf_convert', { files: [{ path: input }], output_dir: output }));
    assert.equal(second.ok, true);
    assert.notEqual(second.outputs[0], result.outputs[0]);
    assert.deepEqual(await fs.readFile(result.outputs[0]), previous);
    const verify = spawnSync(python, ['-c', 'from pypdf import PdfReader; import sys; r=PdfReader(sys.argv[1]); assert r.is_encrypted; assert r.decrypt("test-secret"); assert len(r.pages)==1; assert "DSH" in r.pages[0].extract_text()', result.outputs[0]], { encoding: 'utf8', windowsHide: true });
    assert.equal(verify.status, 0, verify.stderr);
    const inspection = JSON.parse(await call(ctx, 'office2pdf_inspect', {}));
    assert(inspection.engines.office.Word);
    const image = path.join(temp, 'sample.png');
    const create = spawnSync(python, ['-c', 'from PIL import Image; import sys; Image.new("RGB",(64,64),"red").save(sys.argv[1])', image], { encoding: 'utf8', windowsHide: true });
    assert.equal(create.status, 0, create.stderr);
    const merged = JSON.parse(await call(ctx, 'office2pdf_convert', {
      files: [{ path: input }, { path: image }], output_dir: output, options: { merge_all: true, naming_tpl: 'merged' },
    }));
    assert.equal(merged.ok, true, JSON.stringify(merged.logs));
    const check = spawnSync(python, ['-c', 'from pypdf import PdfReader; import sys; assert len(PdfReader(sys.argv[1]).pages)==2', merged.outputs[0]], { encoding: 'utf8', windowsHide: true });
    assert.equal(check.status, 0, check.stderr);
  } finally { ctx.dispose(); }
});
