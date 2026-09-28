const fs=require('fs'),path=require('path')
const dir=path.join(__dirname,'../Logs/wiki-ui-test')
if(!process.versions.electron){
 (async()=>{
 fs.mkdirSync(dir,{recursive:true})
 fs.copyFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),path.join(dir,'pdf.worker.mjs'))
 await require('esbuild').build({entryPoints:[path.join(__dirname,'../tests/wiki-ui.tsx')],outfile:path.join(dir,'test.js'),bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'worker-url',setup(build){build.onResolve({filter:/\?url$/},args=>({path:args.path,namespace:'worker-url'}));build.onLoad({filter:/.*/,namespace:'worker-url'},()=>({contents:'export default "./pdf.worker.mjs"',loader:'js'}))}}]})
 const assets=path.join(__dirname,'../out/renderer/assets')
 const styles=fs.readdirSync(assets).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(assets,p),'utf8')).join('\n')
 fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>${styles} html,body,#root{height:100%;margin:0} body{overflow:hidden}</style></head><body><div id="root"></div><script src="test.js"></script></body></html>`)
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('child_process').spawnSync(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit',timeout:30000})
 if(r.error)throw r.error;process.exitCode=r.status??1
 })().catch(e=>{console.error(e);process.exitCode=1})
}else{
 const {app,BrowserWindow}=require('electron')
 app.setPath('userData',path.join(dir,'profile'));app.disableHardwareAcceleration()
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,plugins:true}})
  await win.loadFile(path.join(dir,'index.html'))
  console.log(await win.webContents.executeJavaScript('window.wikiUITest'))
  await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(dir,'desktop.png'),(await win.webContents.capturePage()).toPNG())
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='PDF 原版阅读').click()`)
  await new Promise(r=>setTimeout(r,1800))
  const pdf=await win.webContents.executeJavaScript(`({width:document.querySelector('canvas')?.width,loading:!!document.querySelector('.kw-pdf [role=status]'),error:document.querySelector('[role=alert]')?.textContent})`)
  if(!pdf.width||pdf.loading||pdf.error)throw Error('PDF render failed: '+JSON.stringify(pdf))
  console.log('PDF canvas rendered:',pdf.width)
  const pdfImage=await win.webContents.executeJavaScript(`document.querySelector('.kw-pdf canvas').toDataURL('image/png').split(',')[1]`)
  fs.writeFileSync(path.join(dir,'pdf.png'),Buffer.from(pdfImage,'base64'))
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='详细知识').click()`)
  win.setContentSize(360,900);await new Promise(r=>setTimeout(r,200))
  const sizes=await win.webContents.executeJavaScript('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})')
  if(sizes.scroll>sizes.width)throw Error('Narrow layout overflow '+JSON.stringify(sizes))
  fs.writeFileSync(path.join(dir,'narrow.png'),(await win.webContents.capturePage()).toPNG())
  if(!await win.webContents.executeJavaScript('window.deleteWikiFileTest()'))throw Error('Wiki file delete failed')
  console.log('Wiki file delete button verified')
  console.log('No overflow at 360px');app.exit(0)
 }).catch(e=>{console.error(e);app.exit(1)})
}
