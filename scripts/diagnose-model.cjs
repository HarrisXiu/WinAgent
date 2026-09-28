#!/usr/bin/env node
/**
 * 模型行为诊断：Wiki 分析 / 规范编译 / 问答等后台任务失败时的第一步排查工具。
 *
 * 用法（需先 npm run plugin:build，npm run diagnose:model 会自动构建）：
 *   npm run diagnose:model                          # 诊断当前激活的服务商（1 次请求）
 *   npm run diagnose:model -- --provider deepseek   # 指定服务商 id
 *   npm run diagnose:model -- --source <jobId|文件名>  # 追加：用该资料的第 1 个片段跑一次真实 Wiki 分析（最多 3 次请求）
 *
 * 只输出元数据（finish_reason、token 用量、正文/思考字数、判定），不输出 API Key、提示词或文档正文。
 * 会消耗少量真实 API 额度。背景见 dsh-plugin/src/llm/TaskChat.ts 顶部说明与 README「故障排查」。
 */
const fs = require('fs')
const path = require('path')
const lib = path.join(__dirname, '..', 'dsh-plugin', 'lib')
const llm = require(path.join(lib, 'llm', 'OpenAIClient'))

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

const dataDir = process.env.WINAGENT_DATA_DIR || path.join(process.env.APPDATA || '', 'com.winagent.app')
const cfgPath = path.join(dataDir, 'config.json')
if (!fs.existsSync(cfgPath)) { console.error(`找不到配置文件：${cfgPath}（可用 WINAGENT_DATA_DIR 指定数据目录）`); process.exit(1) }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const providerId = opt('provider') || cfg.activeProviderId
const provider = (cfg.providers || []).find((p) => p.id === providerId)
if (!provider) { console.error(`配置中没有服务商「${providerId}」，可选：${(cfg.providers || []).map((p) => p.id).join(', ')}`); process.exit(1) }
if (provider.apiKey && provider.apiKey.startsWith('enc:v1:')) { console.error('该服务商的 API Key 是旧版密文，请先在设置中重新填写'); process.exit(1) }

const meta = (r, maxTokens) => ({
  finish_reason: r.finishReason, max_tokens: maxTokens,
  completion_tokens: r.usage ? r.usage.completion : '接口未返回',
  正文字数: r.content.length, 思考字数: (r.reasoning || '').length
})

async function probe() {
  console.log(`服务商：${provider.id}（${provider.type}）  模型：${provider.model}  地址：${provider.baseUrl}`)
  const outputLimit = provider.outputLimit && provider.outputLimit.value
  console.log(`已记录的输出上限：${outputLimit || '未知（使用服务端默认值）'}\n`)
  console.log('[1/1] 关闭思考的小型 JSON 任务（与后台任务相同的调用方式）')
  const maxTokens = 800
  let r
  try {
    r = await llm.chatStream(provider, [
      { role: 'system', content: '只输出 JSON 对象 {"ok":true,"echo":"<把用户输入原样返回>"}，不要任何其他文字。' },
      { role: 'user', content: '诊断' }
    ], { temperature: 0, maxTokens, stream: false, thinking: 'off' })
  } catch (e) {
    console.log('  请求失败：', e instanceof Error ? e.message : String(e))
    console.log('\n判定：连接/认证/额度问题，与模型行为无关。检查网络代理、API Key 与账户余额。')
    return false
  }
  console.log('  ', JSON.stringify(meta(r, maxTokens)))
  let jsonOk = false
  try { jsonOk = !!JSON.parse(r.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')).ok } catch {}
  const thinks = (r.reasoning || '').trim().length > 0
  console.log('\n判定：')
  if (thinks) console.log('  ✗ 关闭思考无效：请求了 thinking=off，响应仍含思考内容。WinAgent 会自动为该模型预留思考余量（+16000 tokens）重试；若仍失败，请换用非思考模型。')
  else console.log('  ✓ 思考可以关闭。')
  if (r.finishReason === 'length') console.log('  ✗ 800 tokens 内未完成一个极小任务：输出被截断，模型或网关的输出预算异常。')
  else console.log(`  ✓ 正常结束（finish_reason=${r.finishReason}）。`)
  if (!r.content.trim()) console.log('  ✗ 正文为空。')
  else console.log(jsonOk ? '  ✓ 能按要求输出 JSON。' : '  ✗ 未按要求输出纯 JSON（Wiki 分析、规范编译依赖 JSON 输出，可能解析失败）。')
  return true
}

async function sourceRun(id) {
  const vault = cfg.vaultPath ? path.resolve(dataDir, cfg.vaultPath) : path.join(dataDir, 'wiki')
  const dir = path.join(vault, '.winagent', 'sources')
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []
  const records = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  const src = records.find((s) => s.id === id || s.title === id || (s.rawPath || '').endsWith(id))
  if (!src) { console.log(`\n没有找到资料「${id}」。可选：\n${records.map((s) => `  ${s.id}  ${s.title}`).join('\n')}`); return }
  if (!src.chunks || !src.chunks.length) { console.log(`\n资料「${src.title}」没有可分析的文本片段（${src.error || '未解析'}）`); return }
  console.log(`\n[追加] 资料「${src.title}」片段 1/${src.chunks.length}（${src.chunks[0].text.length} 字）真实 Wiki 分析，最多 3 次请求`)
  const { analyzeDetailed } = require(path.join(lib, 'wiki', 'DetailedAnalysis'))
  let calls = 0
  llm.setChatFetcher(async (url, init) => {
    if (++calls > 3) throw new Error('诊断已达请求上限（3 次），停止')
    const body = JSON.parse(init.body)
    const res = await fetch(url, init)
    try {
      const j = await res.clone().json(), c = (j.choices || [])[0] || {}, m = c.message || {}
      console.log(`   请求 ${calls}：`, JSON.stringify({ max_tokens: body.max_tokens, thinking: body.thinking && body.thinking.type,
        status: res.status, finish_reason: c.finish_reason, completion_tokens: j.usage && j.usage.completion_tokens,
        正文字数: (m.content || '').length, 思考字数: (m.reasoning_content || m.reasoning || '').length }))
    } catch { console.log(`   请求 ${calls}：HTTP ${res.status}`) }
    return res
  })
  try {
    const r = await analyzeDetailed(provider, src.title, src.chunks[0].text)
    console.log(`  ✓ 片段分析成功：${r.sections.length} 个知识段，原文证据 ${r.sections[0].quotes.length} 条（未写入知识库）`)
  } catch (e) {
    console.log('  ✗ 片段分析失败：', e instanceof Error ? e.message : String(e))
  }
}

;(async () => {
  const ok = await probe()
  const source = opt('source')
  if (ok && source) await sourceRun(source)
})().catch((e) => { console.error(e); process.exit(1) })
