const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fetchModels } = require('../dsh-plugin/lib/llm/OpenAIClient')

const google = {
  id: 'google', label: 'Google', type: 'openai',
  baseUrl: ' https://generativelanguage.googleapis.com/v1beta/openai/ ',
  apiKey: 'test-key', model: ''
}

test('Google OpenAI endpoint uses the supplied configuration and authentication', async () => {
  const models = await fetchModels(google, async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/models')
    assert.equal(init.headers.Authorization, 'Bearer test-key')
    assert.ok(init.signal instanceof AbortSignal)
    return Response.json({ data: [{ id: 'gemini-test' }, { id: 'gemini-test' }, {}, { id: 123 }] })
  })
  assert.deepEqual(models, ['gemini-test'])
})

test('Ollama uses /api/tags and preserves its model names', async () => {
  const models = await fetchModels({ ...google, type: 'ollama', baseUrl: 'http://localhost:11434///' }, async (url, init) => {
    assert.equal(url, 'http://localhost:11434/api/tags')
    assert.equal(init.headers, undefined)
    return Response.json({ models: [{ name: 'local:latest' }] })
  })
  assert.deepEqual(models, ['local:latest'])
})

test('invalid addresses are rejected before sending a request', async () => {
  for (const baseUrl of ['', 'localhost:11434', 'file:///tmp/models', 'https://user:password@example.com', 'https://example.com?key=secret']) {
    await assert.rejects(fetchModels({ ...google, baseUrl }, async () => {
      assert.fail('Invalid addresses must not be requested')
    }), /Base URL/)
  }
})

test('HTTP failures distinguish authentication, permission, missing endpoint and quota', async () => {
  for (const [status, hint] of [[401, '认证失败'], [403, '访问被拒绝'], [404, '模型列表接口不存在'], [429, '配额'], [503, '暂时不可用']]) {
    await assert.rejects(fetchModels(google, async () => new Response('secret response', { status })), error => {
      assert.match(error.message, new RegExp(hint))
      assert.match(error.message, new RegExp(`HTTP ${status}`))
      assert.ok(!error.message.includes('secret'))
      return true
    })
  }
})

test('Node and Electron connection errors produce useful messages without leaking request details', async () => {
  const cases = [
    [new TypeError('fetch failed', { cause: Object.assign(new Error('secret'), { code: 'ENOTFOUND' }) }), '域名解析失败'],
    [new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error(), { code: 'ECONNREFUSED' })]) }), '连接被拒绝'],
    [new Error('net::ERR_PROXY_CONNECTION_FAILED'), '代理连接失败'],
    [new Error('net::ERR_CERT_AUTHORITY_INVALID'), '证书校验失败'],
    [new DOMException('timeout', 'TimeoutError'), '请求超时'],
    [new Error('secret request details'), '网络连接失败']
  ]
  for (const [cause, hint] of cases) {
    await assert.rejects(fetchModels(google, async () => { throw cause }), error => {
      assert.match(error.message, new RegExp(hint))
      assert.ok(!error.message.includes('secret'))
      assert.ok(!error.message.includes(google.apiKey))
      return true
    })
  }
})

test('invalid JSON and incorrect model formats are reported instead of silently appearing empty', async () => {
  await assert.rejects(fetchModels(google, async () => new Response('<html>login</html>')), /有效 JSON/)
  await assert.rejects(fetchModels(google, async () => Response.json({ error: 'unsupported' })), /模型列表格式不正确/)
  assert.deepEqual(await fetchModels(google, async () => Response.json({ data: [] })), [])
})
