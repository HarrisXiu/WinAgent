const fs=require('fs'),path=require('path')
const dir=path.join(__dirname,'../Logs/workbench-ui-test')
if(!process.versions.electron){
 (async()=>{
 fs.mkdirSync(dir,{recursive:true})
 fs.copyFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),path.join(dir,'pdf.worker.mjs'))
 await require('esbuild').build({entryPoints:[path.join(__dirname,'../tests/workbench-ui.tsx')],outfile:path.join(dir,'test.js'),bundle:true,platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.gif':'dataurl'},define:{'process.env.NODE_ENV':'"test"',__APP_VERSION__:JSON.stringify(require('../package.json').version),__TEST_CONFIG__:JSON.stringify(require('../dsh-plugin/lib/config/ConfigStore').defaultConfig())},plugins:[{name:'worker-url',setup(build){build.onResolve({filter:/\?url$/},args=>({path:args.path,namespace:'worker-url'}));build.onLoad({filter:/.*/,namespace:'worker-url'},()=>({contents:'export default "./pdf.worker.mjs"',loader:'js'}))}}]})
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
  for(const [name,page] of [['assistant','助理'],['topic','毕业论文'],['tools','Skills 与 MCP'],['wiki','Wiki 知识库']]){
   await win.webContents.executeJavaScript(`window.showWorkbenchPage(${JSON.stringify(page)})`);win.webContents.invalidate();await new Promise(r=>setTimeout(r,300));fs.writeFileSync(path.join(dir,`${name}.png`),(await win.webContents.capturePage()).toPNG())
  }
  // 深色模式 + / 命令菜单：走 mock saveConfig → ThemeProvider 推导深色令牌
  await win.webContents.executeJavaScript(`(async()=>{const c=await window.winagent.getConfig();await window.winagent.saveConfig({...c,theme:{...c.theme,mode:'dark'}});window.showWorkbenchPage('助理');await new Promise(r=>setTimeout(r,300));const el=document.querySelector('.wb-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'/');el.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));return document.documentElement.dataset.theme+' menu='+!!document.querySelector('.wb-slash-menu')})()`).then(r=>console.log('dark/slash:',r))
  win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(dir,'dark-slash.png'),(await win.webContents.capturePage()).toPNG())
  // 专题右键菜单与删除确认框（浅色）
  const shotJs=async(js,name)=>{await win.webContents.executeJavaScript(js);win.webContents.invalidate();await new Promise(r=>setTimeout(r,350));fs.writeFileSync(path.join(dir,name),(await win.webContents.capturePage()).toPNG())}
  await shotJs(`(async()=>{const c=await window.winagent.getConfig();await window.winagent.saveConfig({...c,theme:{...c.theme,mode:'light'}});const el=document.querySelector('.wb-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));const b=[...document.querySelectorAll('.wb-task-list button')].find(b=>b.textContent.trim()==='毕业论文');b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:430}))})()`,'topic-menu.png')
  await shotJs(`[...document.querySelectorAll('.wb-context-menu button')].find(b=>b.textContent.includes('删除')).click()`,'topic-delete.png')
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.wb-alert button')].find(b=>b.textContent.includes('取消')).click()`)
  win.setContentSize(800,760);await new Promise(r=>setTimeout(r,200));const sizes=await win.webContents.executeJavaScript('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');if(sizes.scroll>sizes.width)throw Error('Workbench overflow '+JSON.stringify(sizes));fs.writeFileSync(path.join(dir,'narrow.png'),(await win.webContents.capturePage()).toPNG());console.log('No overflow at 800px');app.exit(0)
 }).catch(e=>{console.error(e);app.exit(1)})
}
