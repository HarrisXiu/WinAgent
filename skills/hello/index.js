// 示例 skill：从 stdin 读取 JSON 参数，向 stdout 输出结果。
// WinAgent 会以 `node index.js` 运行本文件，参数通过 stdin 以 JSON 传入。
let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let args = {}
  try {
    args = JSON.parse(raw || '{}')
  } catch {
    /* ignore */
  }
  const name = args.name || 'World'
  process.stdout.write(`你好，${name}！这是来自 hello_skill 的问候。当前时间：${new Date().toLocaleString()}`)
})
