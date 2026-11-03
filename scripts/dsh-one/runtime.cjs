'use strict';

// Copied into each bundle. No dependency on WinAgent or sibling bundles.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const imagePattern = /\[\[IMG:(?:data:)?(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)\]\]/g;

async function admitImages(ctx, value) {
  const inputs = [];
  String(value).replace(imagePattern, (_, mime, data) => {
    inputs.push({ mediaType: mime, data: Buffer.from(data.replace(/\s/g, ''), 'base64') });
    return '';
  });
  if (!inputs.length) return String(value);
  const attachments = ctx.get?.('attachments');
  if (!attachments?.saveImages) throw new Error('PDF/Office 视觉输出需要 DSH attachments 服务，请启用本地附件插件。');
  const refs = await attachments.saveImages(inputs);
  let index = 0;
  return String(value).replace(imagePattern, () => `[[DSH_IMAGE:${Buffer.from(JSON.stringify(refs[index++])).toString('base64')}]]`);
}

function render(_args, value) {
  const images = [];
  const text = String(value).replace(/\[\[DSH_IMAGE:([A-Za-z0-9+/=]+)\]\]/g,
    (_, data) => {
      images.push({ type: 'image', attachment: JSON.parse(Buffer.from(data, 'base64').toString('utf8')) });
      return '';
    }).trim();
  return [{ type: 'text', text: text || '(无文本输出)' }, ...images];
}

function registerTools(ctx, tools, config = {}) {
  const prefix = config.toolPrefix ?? 'winagent_';
  if (typeof prefix !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
    throw new Error('toolPrefix 必须是字母、数字、下划线组成的非空前缀');
  }
  const risky = new Set();
  const disposers = [];
  // Preserve previous deny/ask decisions and use DSH's approval channel.
  if (typeof ctx.on !== 'function' && tools.some(t => t.dangerous)) {
    throw new Error('此 DSH 宿主缺少 tools/pre-execute 审批接口');
  }
  if (typeof ctx.on === 'function') {
    disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next();
      if (decision.kind !== 'allow' || !risky.has(exec.name)) return decision;
      return { kind: 'ask', reason: `${exec.name} 会执行文件写入、系统修改或外部操作，请确认本次调用。` };
    }));
  }
  try { for (const tool of tools) {
    const name = prefix + tool.schema.name;
    if (tool.dangerous) risky.add(name);
    disposers.push(ctx.tools.register({
      name,
      description: tool.schema.description,
      parameters: tool.schema.parameters,
      output: { schema: { type: 'string' }, render },
      isConcurrencySafe: () => false,
      timeoutMs: config.timeoutMs ?? (tool.schema.name.startsWith('office2pdf_') ? 600000 : 300000),
      async execute(args, exec) {
        exec?.signal?.throwIfAborted();
        const result = await tool.run(args || {}, exec);
        exec?.signal?.throwIfAborted();
        return admitImages(ctx, result);
      },
    }));
  } } catch (error) {
    for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose();
    throw error;
  }
  return () => { for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose(); };
}

function effect(ctx, dispose) {
  ctx.effect(() => dispose);
}

function runJsonProcess(command, args, input, { signal, cwd, env, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args, { cwd, env: env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => { child.kill(); finish(new Error('操作已取消')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error(`子进程超过 ${timeoutMs}ms，已停止等待；请检查已生成的文件`)); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 32 * 1024 * 1024) { child.kill(); finish(new Error('子进程输出超过 32MB')); }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString('utf8')).slice(-16000); });
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('close', code => {
      if (code !== 0) return finish(new Error(errors.trim() || `子进程退出码 ${code}`));
      try { finish(null, JSON.parse(output)); }
      catch { finish(new Error(`子进程未返回有效 JSON：${output.slice(0, 300)}`)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function loadFamily(root, spec, config) {
  let tools = [];
  if (spec.module) tools.push(...require(path.join(root, 'lib', spec.module))[spec.export]);
  if (spec.skillDirs?.length) {
    const { loadSkills } = require(path.join(root, 'lib/skills/SkillLoader.js'));
    for (const dir of spec.skillDirs) tools.push(...await loadSkills(path.join(root, 'assets/skills', dir)));
  }
  return tools;
}

module.exports = { render, admitImages, registerTools, effect, runJsonProcess, loadFamily };
