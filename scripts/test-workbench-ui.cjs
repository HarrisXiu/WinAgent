const fs=require('fs'),path=require('path')
const dir=path.join(__dirname,'../Logs/workbench-ui-test')
if(!process.versions.electron){
 (async()=>{
 fs.mkdirSync(dir,{recursive:true})
 fs.copyFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),path.join(dir,'pdf.worker.mjs'))
 await require('esbuild').build({entryPoints:[path.join(__dirname,'../tests/workbench-ui.tsx')],outfile:path.join(dir,'test.js'),bundle:true,platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.gif':'dataurl'},define:{'process.env.NODE_ENV':'"test"',__TEST_CONFIG__:JSON.stringify(require('../dsh-plugin/lib/config/ConfigStore').defaultConfig())},plugins:[{name:'worker-url',setup(build){build.onResolve({filter:/\?url$/},args=>({path:args.path,namespace:'worker-url'}));build.onLoad({filter:/.*/,namespace:'worker-url'},()=>({contents:'export default "./pdf.worker.mjs"',loader:'js'}))}}]})
 const assets=path.join(__dirname,'../out/renderer/assets')
 const styles=fs.readdirSync(assets).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(assets,p),'utf8')).join('\n')
 fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>${styles} html,body,#root{height:100%;margin:0} body{overflow:hidden}</style></head><body><div id="root"></div><script src="test.js"></script></body></html>`)
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('child_process').spawnSync(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit',timeout:45000});if(r.error)throw r.error;process.exitCode=r.status??1
 })().catch(e=>{console.error(e);process.exitCode=1})
}else{
 const {app,BrowserWindow}=require('electron');app.setPath('userData',path.join(dir,'profile'));app.disableHardwareAcceleration()
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}})
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.error(message)})
  await win.loadFile(path.join(dir,'index.html'));console.log(await win.webContents.executeJavaScript('window.workbenchTest'))
  for(const [name,page] of [['assistant','助理'],['topic','专题任务'],['tools','Skills 与 MCP'],['wiki','Wiki 知识库']]){
   await win.webContents.executeJavaScript(`window.showWorkbenchPage(${JSON.stringify(page)})`);win.webContents.invalidate();await new Promise(r=>setTimeout(r,300));fs.writeFileSync(path.join(dir,`${name}.png`),(await win.webContents.capturePage()).toPNG())
  }
  win.setContentSize(800,760);await new Promise(r=>setTimeout(r,200));const sizes=await win.webContents.executeJavaScript('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');if(sizes.scroll>sizes.width)throw Error('Workbench overflow '+JSON.stringify(sizes));fs.writeFileSync(path.join(dir,'narrow.png'),(await win.webContents.capturePage()).toPNG());console.log('No overflow at 800px');app.exit(0)
 }).catch(e=>{console.error(e);app.exit(1)})
}
