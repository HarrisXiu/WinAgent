/* WinAgent DSH 插件 —— 前端 UI（无构建、无框架） */
'use strict'

// ────────────────────────── 基础工具 ──────────────────────────

function $(id) { return document.getElementById(id) }
function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
let toastTimer = null
function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200)
}

// ────────────────────────── Markdown 渲染 ──────────────────────────

function renderInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_m, c) => '<code>' + c + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p, label) =>
      '<a href="javascript:void(0)" data-wikilink="' + esc(p) + '">' + esc(label || p) + '</a>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

function md(text) {
  const src = String(text ?? '')
  const lines = src.split('\n')
  const out = []
  let i = 0
  let inCode = false
  let codeBuf = []
  let codeLang = ''
  let listBuf = []
  let listKind = ''
  const flushList = () => {
    if (!listBuf.length) return
    out.push(listKind === 'ol' ? '<ol>' : '<ul>')
    for (const li of listBuf) out.push('<li>' + renderInline(li) + '</li>')
    out.push(listKind === 'ol' ? '</ol>' : '</ul>')
    listBuf = []
    listKind = ''
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (inCode) {
      if (/^```/.test(line.trim())) {
        out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>')
        inCode = false
        codeBuf = []
      } else codeBuf.push(line)
      continue
    }
    const m = line.match(/^```(\w*)/)
    if (m) { inCode = true; codeLang = m[1]; continue }
    const t = line.trim()
    if (!t) { flushList(); continue }
    if (/^---+$/.test(t)) { flushList(); out.push('<hr>'); continue }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flushList(); out.push('<h' + h[1].length + '>' + renderInline(h[2]) + '</h' + h[1].length + '>'); continue }
    if (/^>\s?/.test(t)) { flushList(); out.push('<blockquote>' + renderInline(t.replace(/^>\s?/, '')) + '</blockquote>'); continue }
    if (/^\|/.test(t) && lines[i + 1] && /^\|[\s:|-]+\|/.test(lines[i + 1].trim())) {
      flushList()
      const header = t.split('|').slice(1, -1).map((c) => c.trim())
      const rows = []
      i += 2
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map((c) => c.trim()))
        i++
      }
      i--
      out.push('<table><thead><tr>' + header.map((c) => '<th>' + renderInline(c) + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => '<td>' + renderInline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>')
      continue
    }
    const ul = line.match(/^[-*+]\s+(.*)$/)
    const ol = line.match(/^\d+\.\s+(.*)$/)
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      const content = (ul ? ul[1] : ol[1])
      if (listKind !== kind) { flushList(); listKind = kind }
      listBuf.push(content)
      continue
    }
    flushList()
    out.push('<p>' + renderInline(esc(line)) + '</p>')
  }
  flushList()
  if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>')
  return out.join('\n')
}

// ────────────────────────── API ──────────────────────────

async function api(path, opts) {
  const r = await fetch('/winagent/api' + path, opts)
  const ct = r.headers.get('content-type') || ''
  const body = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) throw new Error((body && (body.error || body.message)) || ('HTTP ' + r.status))
  return body
}
const get = (p) => api(p)
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })

// ────────────────────────── 状态 ──────────────────────────

const state = {
  config: null,
  seq: 0,
  busy: false,
  pendingAttachments: [],
  curText: '',
  curReasoning: '',
  curBlock: null,
  renderTimer: null,
}

// ────────────────────────── 事件长轮询 ──────────────────────────

async function pollLoop() {
  for (;;) {
    try {
      const res = await get('/agent/events?seq=' + state.seq)
      for (const ev of (res.events || [])) {
        state.seq = Math.max(state.seq, ev.seq)
        try { handleBusEvent(ev.type, ev.data) } catch (e) { /* 事件处理失败不影响轮询 */ }
      }
    } catch (e) { /* 网络瞬断忽略 */ }
  }
}

function handleBusEvent(type, data) {
  if (type === 'agentEvent') return handleAgentEvent(data)
  if (type === 'confirm') return showConfirm(data)
  if (type === 'configChanged') return onConfigChanged(data)
  if (type === 'vaultChanged') { refreshWikiTree(); return }
  if (type === 'ingestProgress') return showProgress('ingest', data)
  if (type === 'customProgress') return showProgress('custom', data)
}

// ────────────────────────── 聊天 ──────────────────────────

function ensureCurBlock() {
  if (state.curBlock) return state.curBlock
  const msg = el('div', 'msg assistant')
  const who = el('div', 'who', 'WinAgent')
  const bubble = el('div', 'bubble')
  msg.appendChild(who)
  msg.appendChild(bubble)
  $('chat').appendChild(msg)
  state.curBlock = bubble
  state.curText = ''
  state.curReasoning = ''
  return bubble
}

function scheduleRender() {
  clearTimeout(state.renderTimer)
  state.renderTimer = setTimeout(() => {
    if (!state.curBlock) return
    const body = state.curBlock.querySelector('.body') || (() => {
      const b = el('div', 'body md')
      state.curBlock.appendChild(b)
      return b
    })()
    body.innerHTML = md(state.curText)
    $('chat').scrollTop = $('chat').scrollHeight
  }, 80)
}

function appendSys(text) {
  ensureCurBlock()
  state.curBlock.appendChild(el('div', 'sysline', text))
  $('chat').scrollTop = $('chat').scrollHeight
}

function handleAgentEvent(e) {
  switch (e.type) {
    case 'round': {
      const hint = $('empty-hint')
      if (hint) hint.remove()
      if (e.round === 1) {
        state.curBlock = null
        ensureCurBlock()
      }
      break
    }
    case 'assistant_delta':
      state.curText += e.text || ''
      scheduleRender()
      break
    case 'reasoning_delta': {
      ensureCurBlock()
      let rs = state.curBlock.querySelector('.reason')
      if (!rs) {
        rs = el('details', 'reason')
        rs.appendChild(el('summary', null, '💭 思考过程'))
        rs.appendChild(el('div', 'body'))
        state.curBlock.appendChild(rs)
      }
      state.curReasoning += e.text || ''
      rs.querySelector('.body').textContent = state.curReasoning
      break
    }
    case 'assistant_message': {
      ensureCurBlock()
      if (e.content) state.curText = e.content
      if (e.reasoning) state.curReasoning = e.reasoning
      scheduleRender()
      break
    }
    case 'tool_call': {
      ensureCurBlock()
      const card = el('div', 'toolcard')
      card.dataset.callId = e.id
      const head = el('div', 'tc-head')
      head.appendChild(el('span', 'tc-badge' + (e.source !== 'builtin' ? ' ' + e.source : ''), e.source || 'builtin'))
      head.appendChild(el('span', 'name', e.name))
      const st = el('span', 'st run', '运行中…')
      head.appendChild(st)
      card.appendChild(head)
      const det = el('details')
      det.appendChild(el('summary', null, '参数'))
      let argsText = e.args
      try { argsText = JSON.stringify(JSON.parse(e.args || '{}'), null, 2) } catch (err) { /* 原文显示 */ }
      det.appendChild(el('pre', null, argsText || '{}'))
      card.appendChild(det)
      const resPre = el('pre')
      resPre.hidden = true
      card.appendChild(resPre)
      state.curBlock.appendChild(card)
      $('chat').scrollTop = $('chat').scrollHeight
      break
    }
    case 'tool_result': {
      const block = state.curBlock
      if (!block) break
      const card = block.querySelector('.toolcard[data-call-id="' + CSS.escape(e.id) + '"]')
      if (!card) break
      const st = card.querySelector('.st')
      st.className = 'st ' + (e.ok ? 'ok' : 'fail')
      st.textContent = e.ok ? '完成' : '失败'
      const resPre = card.querySelectorAll('pre')[1]
      if (resPre) {
        resPre.hidden = false
        resPre.textContent = String(e.result ?? '')
      }
      $('chat').scrollTop = $('chat').scrollHeight
      break
    }
    case 'usage':
      updateUsage(e.session)
      break
    case 'compact':
      appendSys('🧹 上下文已压缩：' + e.before + ' → ' + e.after + ' tokens')
      break
    case 'knowledge':
      appendSys(e.count > 0
        ? '📚 已检索知识库：注入 ' + e.count + ' 条相关笔记'
        : '📚 已检索知识库：未找到相关内容')
      break
    case 'vision':
      if (e.status === 'start') appendSys('👁 视觉模型识别图片中（' + e.model + '）…')
      else if (e.status === 'done') appendSys('👁 视觉识别完成（' + e.model + '）')
      else if (e.status === 'error') appendSys('⚠ 视觉识别出错：' + (e.text || ''))
      break
    case 'error':
      ensureCurBlock()
      state.curBlock.appendChild(el('div', 'errline', '⚠ ' + (e.message || '未知错误')))
      break
    case 'done':
      state.busy = false
      setBusy(false)
      state.curBlock = null
      break
  }
}

function updateUsage(usage) {
  if (!usage) return
  const est = usage.estimated ? '（估）' : ''
  $('usage').textContent = (usage.total || 0) + ' tok' + est
  $('usage').title = '输入 ' + (usage.prompt || 0) + ' / 输出 ' + (usage.completion || 0) + est
}

function setBusy(b) {
  state.busy = b
  $('btn-send').disabled = b
  $('btn-stop').hidden = !b
  $('status').textContent = b ? '工作中…' : ''
}

// ────────────────────────── 确认弹窗 ──────────────────────────

let confirmCtx = null
function showConfirm(data) {
  confirmCtx = data
  $('confirm-name').textContent = data.name
  let argsText = data.args
  try { argsText = JSON.stringify(JSON.parse(data.args || '{}'), null, 2) } catch (err) { /* 原文 */ }
  $('confirm-args').textContent = argsText
  $('confirm-auto').checked = false
  $('confirm-overlay').classList.remove('hidden')
}
async function replyConfirm(approved) {
  const data = confirmCtx
  confirmCtx = null
  $('confirm-overlay').classList.add('hidden')
  if (!$('confirm-auto').checked) {
    if (approved) { /* 单次放行 */ }
  } else if (approved && state.config) {
    state.config.autoApproveTools = true
    await post('/config', state.config).catch(() => {})
  }
  if (!data) return
  await post('/agent/confirm', { id: data.id, approved }).catch(() => {})
}

// ────────────────────────── 附件 ──────────────────────────

function renderChips() {
  const box = $('attach-chips')
  box.textContent = ''
  state.pendingAttachments.forEach((att, i) => {
    const chip = el('div', 'chip')
    chip.appendChild(el('span', null, (att.isImage ? '🖼 ' : '📄 ') + att.name))
    const x = el('span', 'x', '✕')
    x.onclick = () => { state.pendingAttachments.splice(i, 1); renderChips() }
    chip.appendChild(x)
    box.appendChild(chip)
  })
}

async function addFiles(files) {
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase()
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
    const textExts = ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'xml', 'yml', 'yaml', 'csv', 'log', 'sh', 'bat']
    const att = { name: f.name, path: f.name, mime: f.type || '', isImage: imageExts.includes(ext) }
    if (att.isImage) {
      att.dataUrl = await new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = () => resolve(null)
        r.readAsDataURL(f)
      })
    } else if (textExts.includes(ext)) {
      att.textContent = (await f.text()).slice(0, 50000)
    }
    state.pendingAttachments.push(att)
  }
  renderChips()
}

// ────────────────────────── 发送 ──────────────────────────

async function sendMessage() {
  const input = $('input')
  const text = input.value.trim()
  if (!text && !state.pendingAttachments.length) return
  if (state.busy) return

  const hint = $('empty-hint')
  if (hint) hint.remove()

  const userMsg = el('div', 'msg user')
  const bubble = el('div', 'bubble', text || (state.pendingAttachments.length ? '（附件）' : ''))
  userMsg.appendChild(bubble)
  $('chat').appendChild(userMsg)

  const attachments = state.pendingAttachments
  state.pendingAttachments = []
  renderChips()
  input.value = ''
  autoGrow()

  state.curBlock = null
  setBusy(true)
  await post('/agent/send', { text, attachments }).catch((e) => {
    state.busy = false
    setBusy(false)
    const block = ensureCurBlock()
    block.appendChild(el('div', 'errline', '⚠ 发送失败：' + e.message))
  })
  $('chat').scrollTop = $('chat').scrollHeight
}

// ────────────────────────── 头部 / 配置 ──────────────────────────

function renderProviderSelects() {
  const cfg = state.config
  if (!cfg) return
  const ps = $('provider-select')
  ps.textContent = ''
  for (const p of cfg.providers) {
    const opt = el('option', null, p.label + ' (' + p.id + ')')
    opt.value = p.id
    if (p.id === cfg.activeProviderId) opt.selected = true
    ps.appendChild(opt)
  }
  renderModelSelect()
}

function renderModelSelect() {
  const cfg = state.config
  const p = (cfg.providers.find((x) => x.id === cfg.activeProviderId) || cfg.providers[0])
  const ms = $('model-select')
  ms.textContent = ''
  if (!p) return
  const opt = el('option', null, p.model)
  opt.value = p.model
  ms.appendChild(opt)
}

async function switchProvider(id) {
  if (!state.config) return
  state.config.activeProviderId = id
  await post('/config', state.config).catch((e) => toast('保存失败: ' + e.message))
  renderModelSelect()
}

async function fetchModels() {
  const id = $('provider-select').value
  try {
    const res = await get('/models?providerId=' + encodeURIComponent(id))
    if (res && res.error) throw new Error(res.error)
    const list = Array.isArray(res) ? res : []
    const ms = $('model-select')
    ms.textContent = ''
    for (const m of list) {
      const opt = el('option', null, m)
      opt.value = m
      ms.appendChild(opt)
    }
    toast('已拉取 ' + list.length + ' 个模型')
  } catch (e) {
    toast('拉取失败：' + e.message)
  }
}

function onConfigChanged(cfg) {
  state.config = cfg
  renderProviderSelects()
}

async function loadConfig() {
  state.config = await get('/config')
  renderProviderSelects()
  updateUsage(null)
}

// ────────────────────────── 设置面板 ──────────────────────────

function buildSettings() {
  const cfg = JSON.parse(JSON.stringify(state.config))
  const body = $('panel-body')
  body.textContent = ''

  const sec = (title) => { const s = el('div', 'set-sec'); s.appendChild(el('h4', null, title)); body.appendChild(s); return s }
  const row = (secEl, labelText, input) => {
    const r = el('div', 'set-row')
    r.appendChild(el('label', null, labelText))
    r.appendChild(input)
    secEl.appendChild(r)
    return input
  }

  // Providers
  const psec = sec('模型 Providers')
  cfg.providers.forEach((p, i) => {
    const card = el('div', 'provider-card')
    const head = el('div', 'pv-head')
    const labelIn = el('input')
    labelIn.type = 'text'; labelIn.value = p.label; labelIn.placeholder = '名称'
    labelIn.onchange = () => { p.label = labelIn.value }
    const typeSel = el('select')
    for (const t of ['openai', 'ollama']) {
      const o = el('option', null, t === 'openai' ? 'OpenAI 兼容' : 'Ollama')
      o.value = t
      if (p.type === t) o.selected = true
      typeSel.appendChild(o)
    }
    typeSel.onchange = () => { p.type = typeSel.value }
    const del = el('button', 'danger', '✕')
    del.onclick = () => { cfg.providers.splice(i, 1); saveCfg(cfg) }
    head.appendChild(labelIn); head.appendChild(typeSel); head.appendChild(del)
    card.appendChild(head)
    const baseIn = el('input'); baseIn.type = 'text'; baseIn.value = p.baseUrl || ''
    baseIn.onchange = () => { p.baseUrl = baseIn.value }
    row(card, 'Base URL', baseIn)
    const keyIn = el('input'); keyIn.type = 'password'; keyIn.value = p.apiKey || ''
    keyIn.placeholder = 'API Key（留空使用默认）'
    keyIn.onchange = () => { p.apiKey = keyIn.value }
    row(card, 'API Key', keyIn)
    const modelIn = el('input'); modelIn.type = 'text'; modelIn.value = p.model || ''
    modelIn.onchange = () => { p.model = modelIn.value }
    row(card, '模型', modelIn)
    const visSel = el('select')
    for (const [v, l] of [['auto', '图片识别：自动检测'], ['true', '支持'], ['false', '不支持']]) {
      const o = el('option', null, l)
      o.value = v
      const cur = p.supportsVision === undefined ? 'auto' : String(p.supportsVision)
      if (cur === v) o.selected = true
      visSel.appendChild(o)
    }
    visSel.onchange = () => { p.supportsVision = visSel.value === 'auto' ? undefined : visSel.value === 'true' }
    row(card, '图片识别', visSel)
    psec.appendChild(card)
  })
  const addBtn = el('button', null, '＋ 添加 Provider')
  addBtn.onclick = () => {
    cfg.providers.push({ id: 'p' + Date.now().toString(36), label: '新 Provider', type: 'openai', baseUrl: '', apiKey: '', model: '' })
    saveCfg(cfg)
  }
  psec.appendChild(addBtn)

  // 请求行为
  const rsec = sec('请求行为')
  const tempIn = el('input'); tempIn.type = 'number'; tempIn.step = '0.1'; tempIn.value = cfg.temperature
  tempIn.onchange = () => { cfg.temperature = Number(tempIn.value) }
  row(rsec, '温度', tempIn)
  const maxIn = el('input'); maxIn.type = 'number'; maxIn.value = cfg.maxTokens
  maxIn.onchange = () => { cfg.maxTokens = Number(maxIn.value) }
  row(rsec, 'Max Tokens', maxIn)
  const streamChk = el('input'); streamChk.type = 'checkbox'; streamChk.checked = !!cfg.stream
  streamChk.onchange = () => { cfg.stream = streamChk.checked }
  row(rsec, '流式输出', streamChk)
  const thinkSel = el('select')
  for (const [v, l] of [['auto', '自动'], ['on', '开启'], ['off', '关闭']]) {
    const o = el('option', null, l); o.value = v
    if (cfg.thinkingMode === v) o.selected = true
    thinkSel.appendChild(o)
  }
  thinkSel.onchange = () => { cfg.thinkingMode = thinkSel.value }
  row(rsec, '深度思考', thinkSel)
  const autoChk = el('input'); autoChk.type = 'checkbox'; autoChk.checked = !!cfg.autoApproveTools
  autoChk.onchange = () => { cfg.autoApproveTools = autoChk.checked }
  row(rsec, '危险工具自动放行', autoChk)
  const compactIn = el('input'); compactIn.type = 'number'; compactIn.value = cfg.compactThresholdTokens
  compactIn.onchange = () => { cfg.compactThresholdTokens = Number(compactIn.value) }
  row(rsec, '压缩阈值(tokens)', compactIn)
  const keepIn = el('input'); keepIn.type = 'number'; keepIn.value = cfg.keepRecentTurns
  keepIn.onchange = () => { cfg.keepRecentTurns = Number(keepIn.value) }
  row(rsec, '压缩保留轮数', keepIn)

  // 视觉辅助
  const vsec = sec('视觉辅助')
  const vaChk = el('input'); vaChk.type = 'checkbox'; vaChk.checked = !!cfg.visionAssist.enabled
  vaChk.onchange = () => { cfg.visionAssist.enabled = vaChk.checked }
  row(vsec, '启用', vaChk)
  const vaProv = el('select')
  {
    const o0 = el('option', null, '（与主模型同一 API）'); o0.value = ''
    vaProv.appendChild(o0)
    for (const p of cfg.providers) {
      const o = el('option', null, p.label); o.value = p.id
      if (cfg.visionAssist.providerId === p.id) o.selected = true
      vaProv.appendChild(o)
    }
  }
  vaProv.onchange = () => { cfg.visionAssist.providerId = vaProv.value }
  row(vsec, '接口来源', vaProv)
  const vaModel = el('input'); vaModel.type = 'text'; vaModel.value = cfg.visionAssist.model || ''
  vaModel.onchange = () => { cfg.visionAssist.model = vaModel.value }
  row(vsec, '视觉模型名', vaModel)
  const vaPrompt = el('textarea'); vaPrompt.value = cfg.visionAssist.prompt || ''
  vaPrompt.onchange = () => { cfg.visionAssist.prompt = vaPrompt.value }
  row(vsec, '识别指令', vaPrompt)

  // 路径
  const dsec = sec('路径')
  const skillsIn = el('input'); skillsIn.type = 'text'; skillsIn.value = cfg.skillsDir || ''
  skillsIn.onchange = () => { cfg.skillsDir = skillsIn.value }
  row(dsec, 'skills 目录', skillsIn)
  const mcpIn = el('input'); mcpIn.type = 'text'; mcpIn.value = cfg.mcpConfigPath || ''
  mcpIn.onchange = () => { cfg.mcpConfigPath = mcpIn.value }
  row(dsec, 'mcp.json 路径', mcpIn)
  const vaultIn = el('input'); vaultIn.type = 'text'; vaultIn.value = cfg.vaultPath || ''
  vaultIn.onchange = () => { cfg.vaultPath = vaultIn.value }
  row(dsec, '知识库 Vault', vaultIn)

  // 人设 / 系统提示词
  const ssec = sec('人设与系统提示词（AgentService 用它 + 工具清单）')
  const sysTa = el('textarea'); sysTa.value = cfg.petPrompt || ''
  sysTa.style.minHeight = '140px'
  sysTa.onchange = () => { cfg.petPrompt = sysTa.value }
  row(ssec, '人设提示词', sysTa)

  const save = el('button', 'primary', '保存设置')
  save.onclick = () => saveCfg(cfg)
  body.appendChild(save)
}

async function saveCfg(cfg) {
  try {
    state.config = await post('/config', cfg)
    renderProviderSelects()
    toast('设置已保存')
    buildSettings()
  } catch (e) {
    toast('保存失败：' + e.message)
  }
}

// ────────────────────────── 工具面板 ──────────────────────────

async function buildTools() {
  const body = $('panel-body')
  body.textContent = ''
  const head = el('div', 'set-sec')
  const reload = el('button', null, '⟳ 重新加载 tools / skills / MCP')
  reload.onclick = async () => {
    await post('/tools/reload')
    toast('已重新加载')
    buildTools()
  }
  head.appendChild(reload)
  body.appendChild(head)
  let list = []
  try { list = await get('/tools') } catch (e) { body.appendChild(el('div', 'errline', e.message)); return }
  body.appendChild(el('div', 'sysline', '共 ' + list.length + ' 个工具'))
  for (const t of list) {
    const r = el('div', 'tool-row')
    r.appendChild(el('span', 'tname', t.name))
    r.appendChild(el('span', 'src-badge ' + t.source, t.source))
    if (t.dangerous) r.appendChild(el('span', 'danger-badge', '危险'))
    r.appendChild(el('span', 'tdesc', t.description || ''))
    body.appendChild(r)
  }
}

// ────────────────────────── 知识库面板 ──────────────────────────

let wikiNotes = []
let currentNotePath = null
let wikiEditMode = false

async function refreshWikiTree() {
  try {
    wikiNotes = await get('/wiki/notes')
  } catch (e) {
    toast('知识库读取失败：' + e.message)
    return
  }
  const tree = $('wiki-tree')
  if (tree) tree.textContent = ''
  else return
  const renderNode = (n, container) => {
    const node = el('div', 'node' + (n.kind === 'folder' ? ' folder' : ''), (n.kind === 'folder' ? '📁 ' : '📄 ') + (n.title || n.path))
    node.onclick = () => {
      if (n.kind === 'folder') {
        const ch = node.nextElementSibling
        if (ch && ch.classList.contains('children')) ch.classList.toggle('hidden')
        return
      }
      openNote(n.path)
    }
    container.appendChild(node)
    if (n.children && n.children.length) {
      const ch = el('div', 'children')
      n.children.forEach((c) => renderNode(c, ch))
      container.appendChild(ch)
    }
  }
  for (const n of wikiNotes) renderNode(n, tree)
}

async function openNote(path) {
  currentNotePath = path
  wikiEditMode = false
  try {
    const note = await get('/wiki/note?path=' + encodeURIComponent(path))
    const c = $('wiki-content')
    c.textContent = ''
    const h = el('h3', null, note.title)
    const meta = el('div', 'sysline', '标签: ' + (note.tags || []).join(', ') + ' · 更新: ' + note.updated)
    const body = el('div', 'md')
    body.innerHTML = md(note.rawBody || '')
    c.appendChild(h); c.appendChild(meta); c.appendChild(body)
    $('wiki-edit').hidden = true
    $('wiki-save').hidden = true
    $('wiki-cancel').hidden = true
  } catch (e) {
    toast('读取失败：' + e.message)
  }
}

function editCurrentNote() {
  if (!currentNotePath) return
  get('/wiki/note?path=' + encodeURIComponent(currentNotePath)).then((note) => {
    wikiEditMode = true
    $('wiki-content').hidden = true
    const ed = $('wiki-edit')
    ed.hidden = false
    ed.value = note.rawBody || ''
    $('wiki-save').hidden = false
    $('wiki-cancel').hidden = false
  }).catch((e) => toast('读取失败：' + e.message))
}

async function saveCurrentNote() {
  if (!currentNotePath || !wikiEditMode) return
  const bodyText = $('wiki-edit').value
  const note = await get('/wiki/note?path=' + encodeURIComponent(currentNotePath)).catch(() => null)
  const title = (note && note.title) || currentNotePath.split('/').pop().replace(/\.md$/, '')
  const tags = (note && note.tags) || []
  try {
    await post('/wiki/note', { path: currentNotePath, data: { title, tags, body: bodyText } })
    toast('已保存')
    wikiEditMode = false
    $('wiki-edit').hidden = true
    $('wiki-save').hidden = true
    $('wiki-cancel').hidden = true
    $('wiki-content').hidden = false
    await refreshWikiTree()
    openNote(currentNotePath)
  } catch (e) {
    toast('保存失败：' + e.message)
  }
}

function showProgress(kind, p) {
  const box = $('wiki-progress')
  if (!box) return
  if (p.done) {
    box.textContent = ''
    if (p.error) toast(p.file + ': ' + p.error)
    else toast((kind === 'custom' ? '定制分析' : '摄入') + '完成：' + p.file)
    refreshWikiTree()
    return
  }
  box.textContent = p.file + ' · ' + p.stage + ' ' + (p.percent || 0) + '%'
}

function buildWiki() {
  const body = $('panel-body')
  body.textContent = ''
  const wrap = el('div')
  wrap.id = 'wiki-wrap'
  body.appendChild(wrap)

  const tree = el('div')
  tree.id = 'wiki-tree'
  wrap.appendChild(tree)

  const main = el('div')
  main.id = 'wiki-main'
  wrap.appendChild(main)

  const toolbar = el('div')
  toolbar.id = 'wiki-toolbar'
  const searchIn = el('input')
  searchIn.type = 'text'
  searchIn.placeholder = '搜索知识库…'
  searchIn.onkeydown = async (e) => {
    if (e.key !== 'Enter') return
    const q = searchIn.value.trim()
    if (!q) return
    const results = await get('/wiki/search?q=' + encodeURIComponent(q))
    const c = $('wiki-content')
    c.textContent = ''
    c.appendChild(el('h3', null, '搜索：' + q))
    if (!results.length) c.appendChild(el('div', 'wiki-hint', '无结果，换个关键词试试（同义词/英文/缩写）'))
    for (const r of results) {
      const item = el('div', 'hl-list item')
      const a = el('a', null, r.title)
      a.href = 'javascript:void(0)'
      a.onclick = () => openNote(r.path)
      item.appendChild(a)
      item.appendChild(el('span', 'sysline', r.path))
      c.appendChild(item)
      if (r.snippet) c.appendChild(el('div', 'wiki-hint', '…' + r.snippet + '…'))
    }
  }
  toolbar.appendChild(searchIn)
  const urlIn = el('input')
  urlIn.type = 'text'
  urlIn.placeholder = 'URL 导入知识库…'
  urlIn.onkeydown = async (e) => {
    if (e.key !== 'Enter') return
    const u = urlIn.value.trim()
    if (!u) return
    toast('正在抓取并编译网页…')
    const r = await post('/wiki/import/url', { url: u })
    if (r.ok) toast('已导入：' + r.sourcePath)
    else toast('导入失败：' + r.error)
    urlIn.value = ''
  }
  toolbar.appendChild(urlIn)
  const upBtn = el('button', null, '上传文件入库')
  const upInput = el('input')
  upInput.type = 'file'; upInput.multiple = true; upInput.hidden = true
  upBtn.onclick = () => upInput.click()
  upInput.onchange = async () => {
    for (const f of upInput.files) {
      toast('正在摄入：' + f.name)
      try {
        const r = await fetch('/winagent/api/wiki/upload?name=' + encodeURIComponent(f.name), {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: f
        }).then((x) => x.json())
        const first = (r.files && r.files[0]) || {}
        if (first.ingestError) toast(f.name + ' 失败：' + first.ingestError)
        else toast(f.name + ' 已编译：' + (first.sourcePath || '完成'))
      } catch (e) {
        toast('上传失败：' + e.message)
      }
    }
    upInput.value = ''
  }
  toolbar.appendChild(upBtn)
  toolbar.appendChild(upInput)
  const lintBtn = el('button', null, 'LINT')
  lintBtn.onclick = async () => {
    const r = await post('/wiki/workflow/lint')
    toast(r.ok ? 'LINT 完成：' + r.reportPath : 'LINT 失败：' + (r.error || ''))
  }
  toolbar.appendChild(lintBtn)
  const reflectBtn = el('button', null, 'REFLECT')
  reflectBtn.onclick = async () => {
    toast('REFLECT 分析中…')
    const r = await post('/wiki/workflow/reflect')
    toast(r.ok ? 'REFLECT 完成：' + r.reportPath : 'REFLECT 失败：' + (r.error || ''))
  }
  toolbar.appendChild(reflectBtn)
  main.appendChild(toolbar)

  const progLabel = el('div', 'progress-label')
  progLabel.id = 'wiki-progress'
  main.appendChild(progLabel)

  const content = el('div')
  content.id = 'wiki-content'
  content.appendChild(el('div', 'wiki-hint', '← 左侧选择笔记；搜索框检索；上传文件自动编译入库（LLM Wiki）。'))
  main.appendChild(content)

  const edit = el('textarea')
  edit.id = 'wiki-edit'
  edit.hidden = true
  main.appendChild(edit)

  const actions = el('div', 'wiki-actions')
  const btnNew = el('button', null, '新建笔记')
  btnNew.onclick = async () => {
    const name = prompt('相对路径（如 wiki/notes/新笔记.md）：')
    if (!name) return
    try {
      await post('/wiki/note/create', { path: name, title: name.split('/').pop().replace(/\.md$/, '') })
      await refreshWikiTree()
      openNote(name)
    } catch (e) { toast('创建失败：' + e.message) }
  }
  actions.appendChild(btnNew)
  const btnEdit = el('button', null, '编辑')
  btnEdit.onclick = editCurrentNote
  actions.appendChild(btnEdit)
  const btnSave = el('button', 'primary', '保存')
  btnSave.id = 'wiki-save'
  btnSave.hidden = true
  btnSave.onclick = saveCurrentNote
  actions.appendChild(btnSave)
  const btnCancel = el('button', null, '取消')
  btnCancel.id = 'wiki-cancel'
  btnCancel.hidden = true
  btnCancel.onclick = () => {
    wikiEditMode = false
    $('wiki-edit').hidden = true
    $('wiki-save').hidden = true
    $('wiki-cancel').hidden = true
    $('wiki-content').hidden = false
  }
  actions.appendChild(btnCancel)
  const btnDel = el('button', 'danger', '删除')
  btnDel.onclick = async () => {
    if (!currentNotePath) return
    if (!confirm('删除 ' + currentNotePath + ' ？')) return
    try {
      await post('/wiki/note/delete', { path: currentNotePath })
      currentNotePath = null
      toast('已删除')
      await refreshWikiTree()
      $('wiki-content').textContent = ''
      $('wiki-content').appendChild(el('div', 'wiki-hint', '← 左侧选择笔记'))
    } catch (e) { toast('删除失败：' + e.message) }
  }
  actions.appendChild(btnDel)
  main.appendChild(actions)

  refreshWikiTree()
}

// ────────────────────────── 面板控制 ──────────────────────────

function openPanel(title, builder) {
  $('panel-title').textContent = title
  $('panel').classList.remove('hidden')
  builder()
}
function closePanel() {
  $('panel').classList.add('hidden')
}

// ────────────────────────── 输入框 ──────────────────────────

function autoGrow() {
  const input = $('input')
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, 160) + 'px'
}

// ────────────────────────── 启动 ──────────────────────────

function wire() {
  $('btn-send').onclick = sendMessage
  $('btn-stop').onclick = async () => { await post('/agent/stop'); setBusy(false) }
  $('btn-reset').onclick = async () => {
    await post('/agent/reset')
    $('chat').textContent = ''
    const hint = el('div')
    hint.id = 'empty-hint'
    hint.innerHTML = '<h2>WinAgent</h2><p>新会话已开始。</p>'
    $('chat').appendChild(hint)
    $('usage').textContent = '0 tok'
  }
  $('btn-compact').onclick = async () => { toast('压缩中…'); await post('/agent/compact'); toast('压缩完成') }
  $('btn-tools').onclick = () => openPanel('工具', buildTools)
  $('btn-settings').onclick = () => openPanel('设置', buildSettings)
  $('btn-wiki').onclick = () => openPanel('知识库', buildWiki)
  $('panel-close').onclick = closePanel
  $('btn-attach').onclick = () => $('filepick').click()
  $('filepick').onchange = () => { addFiles(Array.from($('filepick').files)); $('filepick').value = '' }
  $('provider-select').onchange = () => switchProvider($('provider-select').value)
  $('model-select').onchange = async () => {
    const cfg = state.config
    const p = cfg.providers.find((x) => x.id === cfg.activeProviderId)
    if (!p) return
    p.model = $('model-select').value
    await post('/config', cfg).catch((e) => toast('保存失败：' + e.message))
  }
  $('btn-models').onclick = fetchModels
  $('confirm-ok').onclick = () => replyConfirm(true)
  $('confirm-deny').onclick = () => replyConfirm(false)

  const input = $('input')
  input.oninput = autoGrow
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }
}

async function boot() {
  wire()
  try {
    await loadConfig()
  } catch (e) {
    toast('配置加载失败（插件可能尚未初始化完成）：' + e.message)
    setTimeout(() => boot(), 2500)
    return
  }
  pollLoop()
  const dir = await get('/data-dir').catch(() => null)
  if (dir) $('status').textContent = ''
}

boot()
