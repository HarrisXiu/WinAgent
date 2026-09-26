// Run the real React provider and AudioQueue in a hidden Electron window.
// Only TTS IPC and audio timing are mocked; no API requests or user data are used.
const fs = require('fs')
const os = require('os')
const path = require('path')

if (!process.versions.electron) {
  const { spawnSync } = require('child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winagent-speech-test-'))
  try {
    require('esbuild').buildSync({
      entryPoints: [path.join(__dirname, '../tests/speech-replay.tsx')],
      outfile: path.join(dir, 'test.js'),
      bundle: true,
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' }
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><body></body>')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [__filename, dir], {
      env, windowsHide: true, stdio: 'inherit', timeout: 30000
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('winagent-speech-test-')) {
      throw new Error('Unexpected test directory')
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  const dir = process.argv[2]
  app.setPath('userData', path.join(dir, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    await win.loadFile(path.join(dir, 'index.html'))
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(dir, 'test.js'), 'utf8'))
    const results = await win.webContents.executeJavaScript('globalThis.speechTestResult')
    for (const result of results) console.log(result)
    app.exit(0)
  }).catch(error => {
    console.error(error)
    app.exit(1)
  })
}
