'use strict';
// Build independent DSH bundles from the current WinAgent source, without touching it.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const matter = require('gray-matter');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'dsh-plugin/src');
const output = path.join(root, 'dsh-one');
const office2pdf = path.resolve(root, '../office2PDF');
const templateRoot = path.join(__dirname, 'dsh-one');
const upstream = require('../dsh-plugin/package.json');
const groups = [
  { id: 'office', title: 'Office 文档', module: 'tools/officeTools.js', export: 'officeTools',
    roots: ['tools/officeTools.ts', 'skills/SkillLoader.ts'], skills: ['docx', 'pptx', 'xlsx'],
    deps: ['gray-matter', 'jszip', 'mathml2omml', 'temml', 'xlsx', 'pptxgenjs', 'word-extractor', 'pdf-parse'],
    detail: 'Word/Excel/PPT 读取、生成、公式与格式转换；Office/PDF 共享提取代码随包携带。' },
  { id: 'pdf', title: 'PDF 阅读与视觉', roots: ['skills/SkillLoader.ts'], skills: ['pdf', 'pdf-render', 'pdf-images'],
    deps: ['gray-matter', 'pdf-parse', 'jszip', 'xlsx', 'word-extractor'], optional: true,
    detail: 'PDF 文本提取、整页渲染和嵌入图片提取；图像标记转为 DSH image 内容。' },
  { id: 'files', title: '文件与目录', module: 'tools/fileTools.js', export: 'fileTools', roots: ['tools/fileTools.ts'],
    detail: '文件读写、编辑、批量编辑、复制、移动、搜索、grep 与目录管理。' },
  { id: 'system', title: 'Windows 系统', module: 'tools/systemTools.js', export: 'systemTools', roots: ['tools/systemTools.ts'],
    detail: '进程、命令、系统信息、截图与开机启动项。需要 Windows。' },
  { id: 'registry', title: 'Windows 注册表', module: 'tools/registryTools.js', export: 'registryTools', roots: ['tools/registryTools.ts'],
    detail: '注册表键和值的读取、写入与删除。需要 Windows。' },
  { id: 'input', title: '键盘与鼠标', module: 'tools/inputTools.js', export: 'inputTools', roots: ['tools/inputTools.ts'],
    detail: '鼠标移动、点击、滚轮、按键、组合键、文本输入、光标与屏幕尺寸。需要 Windows。' },
  { id: 'windows', title: '窗口管理', module: 'tools/windowTools.js', export: 'windowTools', roots: ['tools/windowTools.ts'],
    detail: '查找窗口、调整状态、置前和关闭窗口。需要 Windows。' },
  { id: 'network', title: 'HTTP 网络', module: 'tools/httpTools.js', export: 'httpTools', roots: ['tools/httpTools.ts'],
    detail: 'HTTP 请求与文件下载。' },
  { id: 'wiki', title: 'Wiki 知识库', factory: 'wiki', roots: ['wiki/wiki-host.ts', 'tools/wikiTools.ts', 'event-bus.ts'],
    deps: ['gray-matter', 'pdf-parse', 'jszip', 'xlsx', 'word-extractor'],
    detail: '完整迁移十个知识库工具，补充本地文件分析和 URL 导入。模型配置沿用数据目录 config.json。',
    extras: ['import_knowledge_files', 'import_knowledge_url'] },
  { id: 'voice', title: '语音与克隆音色', factory: 'voice', roots: ['voice/VoiceService.ts', 'voice/VoiceStore.ts', 'event-bus.ts'],
    detail: 'MiMo TTS 与本地克隆音色；朗读适配为生成音频文件，由 DSH present_files 展示播放。',
    extras: ['speak_text', 'list_voice_clones', 'add_voice_clone'] },
  { id: 'extensions', title: 'Skills 与 MCP 扩展', factory: 'extensions', roots: ['skills/SkillLoader.ts', 'mcp/McpManager.ts'],
    skills: ['hello'], deps: ['gray-matter'],
    detail: '原生 manifest.json / SKILL.md 加载器、stdin JSON 执行协议、MCP stdio/HTTP 挂载与 hello 示例。通过 skillsDirs/mcpConfigPath 配置。' },
  { id: 'office2pdf', title: 'office2PDF 批量处理', factory: 'office2pdf', roots: [],
    detail: '独立移植 office2PDF 的 Python 转换引擎与会话隔离，支持 Office/WPS、PDF/图片、双水印、页码、合并/拆分、密码、空白页处理。',
    extras: ['office2pdf_convert', 'office2pdf_inspect'] },
];

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function copy(file, target) { write(target, fs.readFileSync(file)); }
function toolNames(text) {
  const source = ts.createSourceFile('tool.ts', text, ts.ScriptTarget.Latest, true);
  const names = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'schema' && ts.isObjectLiteralExpression(node.initializer)) {
      const name = node.initializer.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'name');
      if (name && ts.isStringLiteral(name.initializer)) names.push(name.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return names;
}
function vendor(bundle, entries) {
  const seen = new Set();
  function add(relative) {
    if (seen.has(relative)) return;
    seen.add(relative);
    const text = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (spec.startsWith('.')) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec + '.ts'));
          if (!fs.existsSync(path.join(sourceRoot, target))) throw new Error(`未找到依赖 ${relative} -> ${target}`);
          add(target);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    write(path.join(bundle, 'src', relative), text);
    const compiled = ts.transpileModule(text, { fileName: relative, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    }, reportDiagnostics: true });
    const errors = compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) || [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n',
    }));
    write(path.join(bundle, 'lib', relative.replace(/\.ts$/, '.js')), compiled.outputText);
  }
  entries.forEach(add);
  return [...seen].sort();
}
function copySkill(bundle, id) {
  const src = path.join(root, 'dsh-plugin/assets/skills', id);
  const target = path.join(bundle, 'assets/skills', id);
  fs.cpSync(src, target, { recursive: true });
  // Office readers share extract.js without depending on the PDF bundle.
  if (['docx', 'pptx', 'xlsx'].includes(id)) {
    const entry = path.join(target, `read_${id}.js`);
    write(entry, fs.readFileSync(entry, 'utf8').replace(/\.\.\/pdf\/extract/g, '../common/extract'));
    copy(path.join(root, 'dsh-plugin/assets/skills/pdf/extract.js'), path.join(bundle, 'assets/skills/common/extract.js'));
  }
  const manifest = path.join(src, 'manifest.json');
  return fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8'))
    : matter(fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8')).data;
}

const inventory = [];
for (const group of groups) {
  const packageName = `dsh-winagent-${group.id}`;
  const bundle = path.join(output, packageName);
  const files = vendor(bundle, group.roots);
  const names = group.module ? toolNames(fs.readFileSync(path.join(sourceRoot, group.module.replace(/\.js$/, '.ts')), 'utf8')) : [];
  if (group.id === 'wiki') names.push(...toolNames(fs.readFileSync(path.join(sourceRoot, 'tools/wikiTools.ts'), 'utf8')));
  const skills = [];
  for (const skill of group.skills || []) {
    const meta = copySkill(bundle, skill);
    names.push(meta.name);
    skills.push({ directory: skill, name: meta.name, entry: meta.entry, runtime: meta.runtime || 'node' });
  }
  names.push(...group.extras || []);
  if (group.id === 'wiki') {
    for (const filename of ['read_doc.js', 'extract.js']) copy(path.join(root, 'dsh-plugin/assets/skills/pdf', filename), path.join(bundle, 'assets/skills/pdf', filename));
  }
  if (group.id === 'office2pdf') {
    for (const filename of ['conversion_core.py', 'desktop_service.py', 'office_backend.py', 'blank_pages.py']) {
      copy(path.join(office2pdf, filename), path.join(bundle, 'python', filename));
    }
    copy(path.join(templateRoot, 'bridge.py'), path.join(bundle, 'python/bridge.py'));
    write(path.join(bundle, 'python/requirements.txt'), 'pywin32>=312\npypdf>=6.18,<7\nPillow>=12.3,<13\nreportlab>=5,<6\npypdfium2==5.13.0\n');
    copy(path.join(office2pdf, 'LICENSE'), path.join(bundle, 'LICENSE'));
    for (const filename of ['test_office_backend.py', 'test_blank_pages.py', 'test_desktop_service.py']) copy(path.join(office2pdf, filename), path.join(bundle, 'python', filename));
  } else copy(path.join(root, 'LICENSE'), path.join(bundle, 'LICENSE'));
  if (group.id === 'extensions') copy(path.join(root, 'dsh-plugin/assets/skills/README.md'), path.join(bundle, 'assets/skills/README.md'));
  copy(path.join(templateRoot, 'runtime.cjs'), path.join(bundle, 'lib/runtime.cjs'));
  if (group.factory) copy(path.join(templateRoot, `${group.factory}.cjs`), path.join(bundle, 'lib/factory.cjs'));
  const spec = { module: group.module, export: group.export, skillDirs: group.skills || [] };
  write(path.join(bundle, 'lib/index.js'), `'use strict';
const path = require('node:path');
const { registerTools, effect, loadFamily } = require('./runtime.cjs');
exports.name = ${JSON.stringify(packageName)};
exports.inject = ['tools'];
exports.apply = async function(ctx, config = {}) {
  if (config.enabled === false) return;
  const instance = ${group.factory ? "await require('./factory.cjs').create(config)" : `{ tools: await loadFamily(path.resolve(__dirname, '..'), ${JSON.stringify(spec)}, config), dispose() {} }`};
  let unregister;
  try { unregister = registerTools(ctx, instance.tools, config); }
  catch (error) { instance.dispose(); throw error; }
  effect(ctx, () => { unregister(); instance.dispose(); });
};
`);
  const dependencies = Object.fromEntries((group.deps || []).map(name => [name, upstream.dependencies[name]]));
  const pkg = { name: packageName, version: '1.0.0', description: group.title + '：' + group.detail,
    license: 'MIT', main: 'lib/index.js', exports: { '.': './lib/index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
    icon: './icon.svg', files: ['lib', 'src', 'assets', 'python', 'locale', 'icon.svg', 'cordis.patch.yml', 'README.md', 'LICENSE', 'MIGRATION.json', 'tools', 'tsconfig.json'],
    engines: { node: '>=22' }, scripts: { build: 'node tools/build.cjs' },
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
    ...(group.optional ? { optionalDependencies: upstream.optionalDependencies } : {}),
    ...(files.length ? { devDependencies: { typescript: '^5.4.5', '@types/node': '^20.12.7' } } : {}),
    dsh: { bundle: { patch: './cordis.patch.yml' } } };
  write(path.join(bundle, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  write(path.join(bundle, '.gitignore'), 'node_modules/\n__pycache__/\n*.pyc\n*.tgz\n');
  if (group.id === 'office2pdf') write(path.join(bundle, 'python/.npmignore'), '__pycache__/\n*.pyc\n');
  write(path.join(bundle, 'cordis.patch.yml'), `- insert:\n    - id: ${packageName}\n      name: ${packageName}\n`);
  for (const lang of ['zh', 'en']) write(path.join(bundle, `locale/${lang}.json`), JSON.stringify({ meta: { title: group.title, description: group.detail } }, null, 2));
  write(path.join(bundle, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="14" fill="#2563eb"/><path d="M18 18h28v28H18z" fill="none" stroke="white" stroke-width="3"/><path d="M24 27h16M24 34h16M24 41h10" stroke="white" stroke-width="3"/></svg>\n`);
  write(path.join(bundle, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true,
    lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: false, rootDir: 'src', outDir: 'lib', types: ['node'],
  }, include: ['src/**/*.ts'] }, null, 2));
  write(path.join(bundle, 'tools/build.cjs'), `'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'src'))) { console.log('本插件无需 TypeScript 构建'); process.exit(0); }
const ts = require('typescript');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\\n' })); process.exit(1); }
program.emit();
`);
  const record = { id: group.id, package: packageName, title: group.title, tools: names.map(n => 'winagent_' + n), skills, sourceFiles: files,
    origins: group.id === 'office2pdf' ? ['office2PDF/conversion_core.py', 'office2PDF/desktop_service.py', 'office2PDF/office_backend.py', 'office2PDF/blank_pages.py'] : files.map(f => 'WinAgent/dsh-plugin/src/' + f),
    runtime: group.id === 'office2pdf' ? 'Node.js 22 + Windows Python 3 + pywin32' : 'Node.js 22',
  };
  write(path.join(bundle, 'MIGRATION.json'), JSON.stringify(record, null, 2) + '\n');
  const configuration = group.id === 'office2pdf'
    ? '\n配置 `pythonPath` 为安装了 `python/requirements.txt` 的 Python 完整路径。\n```powershell\npython -m pip install -r python/requirements.txt\n```\nOffice/WPS 输入需安装相应软件；PDF/图片处理只需 Python 依赖。引擎探测分别报告 Word/Excel/PowerPoint，不启动用户的 Office 会话。\n'
    : group.id === 'extensions' ? '\n配置 `skillsDirs: [绝对路径, ...]` 和可选 `mcpConfigPath: 绝对路径`。扩展工具也添加 `winagent_` 前缀；MCP 工具保持审批标记。修改目录/配置后重载插件。\n'
    : ['wiki', 'voice'].includes(group.id) ? '\n模型/语音配置读取 `$DSH_HOME/winagent/config.json`（可用 `WINAGENT_DATA_DIR` 覆盖）。不自动复制桌面版的私有配置。Wiki 可通过 `vaultPath` 指定知识库目录。MiMo 朗读返回音频文件路径，调用 DSH 的 `present_files` 展示播放；音色样本存储在同一数据目录。\n'
    : group.optional ? '\n页面渲染与图片抽取使用可选依赖 `pdfjs-dist` 和 `@napi-rs/canvas`；缺失时文本提取仍可用。\n' : '';
  write(path.join(bundle, 'README.md'), `# ${packageName} · ${group.title}\n\n${group.detail}\n\n独立 DSH bundle，直接注册到 \`ctx.tools\`，无需原 WinAgent 安装目录或其他分类插件。保留源代码、skill 与许可证。\n\n## 安装\n\n在 DSH Plugins 页面添加本文件夹的绝对路径，或执行：\n\n\`dsh plugin --profile desktop add "file:<本文件夹绝对路径>"\`\n\nfile: 方式由 pnpm 安装本包依赖；使用 link: 开发方式时，先在本插件目录执行 npm install --omit=dev。\n\n重启 DSH。可以按需只安装这一类，不会自动安装全部插件。已有整合版 dsh-winagent 可以继续使用，其私有 Agent 工具和这里的 DSH 原生工具分别注册。\n\n## 工具\n\n${names.map(n => '- \`winagent_' + n + '\`').join('\n')}\n\n## 配置\n\n默认 \`enabled: true\`、\`toolPrefix: winagent_\`、\`timeoutMs: ${group.id === 'office2pdf' ? '600000' : '300000'}\`。插件通过 DSH 的 \`tools/pre-execute\` 请求批准原有 dangerous 操作；没有审批服务时 DSH 会拒绝此调用。${configuration}\n\n## 开发\n\n\`npm install\` 后可执行 \`npm run build\`，对保留的 TypeScript 源码进行类型检查并编译。编译不会覆盖 DSH 适配入口和 factory。\`MIGRATION.json\` 记录迁移来源与工具清单。\n\n## 执行边界\n\n沿用 WinAgent 工具内部超时和行为。原有 PowerShell/COM 工具只在调用前后检查取消信号，中途取消可能仍完成已启动的操作；office2PDF 子进程支持取消和超时，已经输出的文件会保留。多会话共享同一知识库时，请避免同时运行写入工作流。\n`.replace(/\`/g, '`'));
  inventory.push(record);
  console.log(`${packageName}: ${names.length} tools, ${skills.length} skills, ${files.length} source files`);
}
write(path.join(output, 'plugins.json'), JSON.stringify(inventory, null, 2) + '\n');
const allNames = inventory.flatMap(g => g.tools);
if (new Set(allNames).size !== allNames.length) throw new Error('分类后存在重复工具');
const markdown = `# WinAgent → DSH 分类插件\n\n共 ${inventory.length} 个独立插件，${allNames.length} 个静态工具（包含原有 7 个 skills）；外部 Skills/MCP 的工具按配置动态增加。每个子文件夹都可直接添加到 DSH Plugins。\n\n| 文件夹 | 分类 | 工具数 |\n| --- | --- | ---: |\n${inventory.map(g => `| [${g.package}](./${g.package}/README.md) | ${g.title} | ${g.tools.length} |`).join('\n')}\n\n工具和 skill 完整映射见 [plugins.json](./plugins.json)。本次迁移覆盖当前 ToolRegistry 注册的全部七组静态工具、Wiki 工具、语音工具和 assets/skills；根 skills/ 中的五个 skill 是较早版本副本，采用 assets/skills 中的新实现，不重复注册。office2PDF 另立专用插件。\n\n## 安装\n\n按需在 DSH Plugins 页面添加分类文件夹绝对路径，或 \`dsh plugin --profile desktop add "file:<插件绝对路径>"\`。每个包有 package.json、cordis.patch.yml、入口、已编译 lib、来源清单与说明。不会复制原项目 node_modules、私有配置或构建缓存。工具使用统一 winagent_ 前缀，避免与 DSH 原生 read_file/grep 冲突。\n\n采用 file: 目录地址安装，DSH 的 pnpm 会安装包清单里的 npm 依赖；使用 link: 时先在插件目录执行 npm install --omit=dev。office2PDF 额外需要配置 Python，详见其 README。插件只提供 DSH 原生 Agent 工具，不复制 Electron 聊天窗口、桌宠或主题 UI。\n\n## 更新与验证\n\nWinAgent 仓库中运行 \`node scripts/build-dsh-one.cjs\` 重新生成分类插件；\`node --test tests/dsh-one.test.cjs\` 进行注册、清单覆盖、审批、文件/Office/PDF 与 office2PDF 验证。构建中间结果放在 WinAgent/dsh-one，交付副本放在桌面 dsh-one；现有 dsh-plugin-finder 保留。\n`;
write(path.join(output, 'WinAgent-插件分类说明.md'), markdown.replace(/\`/g, '`'));
