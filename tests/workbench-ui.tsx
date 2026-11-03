import React from 'react'
import {createRoot} from 'react-dom/client'
import App from '../src/renderer/src/App'
import ThemeProvider from '../src/renderer/src/theme/ThemeProvider'
import {makePdf} from './pdf-fixture.cjs'
declare const __TEST_CONFIG__: any
const cfg=__TEST_CONFIG__
cfg.providers=[{id:'fixture',label:'测试 API',type:'openai',baseUrl:'https://example.invalid',apiKey:'',model:'test-model'}];cfg.activeProviderId='fixture'
let callback=(e:any)=>{},configCallbacks:Array<(c:any)=>void>=[],seq=0,active=''
const state=()=>({history:[],activeRules:[],usage:{prompt:0,completion:0,total:0,estimated:false}})
const records=new Map<string,any>()
records.set('assistant',{id:'assistant',title:'助理',kind:'assistant',updated:new Date().toISOString(),turns:[],state:state()})
const tools=[{name:'read_file',description:'读取本地文件内容',source:'builtin',dangerous:false},{name:'read_pdf',description:'提取 PDF 文档文字',source:'skill',dangerous:false},{name:'mcp_notes_search',description:'搜索外部笔记服务',source:'mcp',dangerous:false}]
const source={id:'source1',title:'论文写作规范.pdf',rawPath:'raw/guide.pdf',hash:'abc123',sourcePath:'wiki/sources/guide.md',created:'2026-09-27',status:'ready',chunks:[{id:'part-1',text:'论文必须包含摘要、方法和讨论。没有数据时标记待补充，禁止编造。',lineStart:1,lineEnd:2}],sections:[]}
const note={path:source.sourcePath,title:source.title,kind:'file',created:'2026-09-27',updated:'2026-09-27',tags:['专题:毕业论文'],links:[],rawBody:'# 论文写作规范\n\n## 结构与证据\n\n论文必须包含摘要、方法和讨论。没有数据时保留待补充项，禁止编造实验结论。\n\n## 格式要求\n\n正文使用统一的标题层级，图表应附编号与来源。'}
let mcpSaved=''
;(window as any).winagent={
 getConfig:async()=>cfg,saveConfig:async(c:any)=>{Object.assign(cfg,c);configCallbacks.forEach(fn=>fn(cfg));return cfg},onConfigChanged:(fn:any)=>{configCallbacks.push(fn);return()=>{configCallbacks=configCallbacks.filter(f=>f!==fn)}},fetchModels:async()=>['test-model'],detectOutputLimit:async()=>({key:'fixture',value:8192,source:'test metadata',detectedAt:new Date().toISOString()}),
 listTools:async()=>tools,reloadTools:async()=>tools,pickDirectory:async()=>'C:/skills/example',getMcpConfig:async()=>'{"mcpServers":{"notes":{"url":"https://example.invalid/mcp"}}}',saveMcpConfig:async(s:string)=>{mcpSaved=s;return tools},
 onEvent:(fn:any)=>{callback=fn;return()=>{}},onConfirm:()=>()=>{},stop:async()=>{},reset:async()=>{},compact:async()=>{},
 send:async(text:string)=>{callback({type:'round',round:1,historyCount:1});await new Promise(r=>setTimeout(r,(window as any).slowSend?400:20));callback({type:'assistant_message',content:'已按任务要求整理，并保留原文证据。'});callback({type:'done'})},
 regenerate:async()=>{callback({type:'round',round:1,historyCount:1});await new Promise(r=>setTimeout(r,20));callback({type:'assistant_message',content:'这是重新生成的回复。'});callback({type:'done'})},
 chats:{list:async()=>[...records.values()].map(({id,title,updated,kind,topicTag,archived})=>({id,title,updated,kind,topicTag,archived:!!archived})),
  renameTopic:async(id:string,title:string)=>{const r=records.get(id),from=r.topicTag,to=`专题:${title.trim()}`;records.set(id,{...r,title:title.trim(),topicTag:to});const hit=note.tags.includes(from);note.tags=note.tags.map((t:string)=>t===from?to:t);return {wikiFiles:hit?1:0}},
  archiveTopic:async(id:string,archived:boolean)=>{records.set(id,{...records.get(id),archived})},
  deleteTopic:async(id:string,removeWikiTag:boolean)=>{const r=records.get(id);records.delete(id);const hit=note.tags.includes(r.topicTag);if(removeWikiTag)note.tags=note.tags.filter((t:string)=>t!==r.topicTag);return {wikiFiles:removeWikiTag&&hit?1:0}},open:async(id:string)=>{active=id||'assistant';return records.get(active)},createTopic:async(title:string)=>{active=`topic-${++seq}`;const record={id:active,title,kind:'topic',topicTag:`专题:${title}`,updated:new Date().toISOString(),turns:[],state:state()};records.set(active,record);return record},save:async(id:string,turns:any[],context:any,draft:string)=>{const old=records.get(id);records.set(id,{...old,updated:new Date().toISOString(),turns,state:state(),context,draft})}},
 tts:{onSegment:()=>()=>{},onSessionEnd:()=>()=>{},cancel:async()=>{},ack:()=>{}},
 wiki:{sources:async()=>[source],listNotes:async()=>[note],jobs:async()=>[],ruleSets:async()=>[],onVaultChanged:()=>()=>{},onChatContext:()=>()=>{},onIngestProgress:()=>()=>{},readNote:async()=>note,getNotesByTag:async(tag:string)=>note.tags.includes(tag)?[note]:[],writeNote:async(_path:string,data:any)=>{note.tags=data.tags},deleteNote:async()=>{},pdfData:async()=>makePdf(),openOriginal:async()=>{},pickFiles:async()=>[],listAnalysisTags:async()=>[]}
}
const wait=async(fn:()=>boolean)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI timeout: '+fn.toString().slice(0,160))}
const button=(text:string)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text||b.title===text||b.getAttribute('aria-label')===text);if(!b)throw Error('Missing '+text);return b}
const click=(text:string)=>button(text).click()
const setText=(selector:string,value:string)=>{const el=document.querySelector(selector) as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
const setInput=(selector:string,value:string)=>{const el=document.querySelector(selector) as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
// 测试 profile 跨次运行保留 localStorage：侧栏宽度每跑一次 +1 步，累积到上限后键盘调宽用例必然失败
try{localStorage.removeItem('winagent:sidebar-width')}catch{}
const root=createRoot(document.getElementById('root')!)
root.render(<ThemeProvider><App/></ThemeProvider>)
;(window as any).workbenchTest=(async()=>{
 const checks:string[]=[];const check=(ok:any,label:string)=>{if(!ok)throw Error(label);checks.push(label)}
 await wait(()=>!!document.querySelector('.wb-new-task')&&!button('新建专题任务 Ctrl+Shift+N').disabled)
 check(document.querySelectorAll('.wb-primary-nav > button').length===3,'assistant, tools and Wiki navigation (topics live in the list below)')
 setText('.wb-composer textarea','整理论文写作计划');await wait(()=>!button('发送消息').disabled);click('发送消息')
 await wait(()=>document.body.textContent!.includes('已按任务要求整理'));await wait(()=>!button('新建专题任务 Ctrl+Shift+N').disabled)
 await wait(()=>!!document.querySelector('[aria-label="重新生成回复"]'));click('重新生成回复')
 await wait(()=>document.body.textContent!.includes('这是重新生成的回复'))
 check(!document.body.textContent!.includes('已按任务要求整理')&&document.querySelectorAll('.wb-message-list > div').length===2,'regenerate replaces the latest reply')
 click('Wiki 知识库');await wait(()=>!document.querySelector<HTMLElement>('.wb-wiki-page')!.hidden)
 ;(document.querySelector('.kw-title-link') as HTMLButtonElement).click();await wait(()=>!!document.querySelector('.kw-document'))
 click('原文与证据');await wait(()=>!!document.querySelector('.kw-original'));click('选段加入提问')
 await wait(()=>!!document.querySelector<HTMLElement>('.wb-chat:not([hidden])'))
 check(document.querySelector<HTMLTextAreaElement>('.wb-composer textarea')!.value.includes('禁止编造'),'quote moves to assistant chat')
 click('Skills 与 MCP');await wait(()=>!!document.querySelector('.wb-market'))
 check(document.querySelectorAll('.wb-tool-row').length===3,'existing tools and sources are displayed')
 click('添加 Skills 目录');await wait(()=>cfg.skillsDirs?.includes('C:/skills/example'));check(true,'adding skills preserves primary directory')
 click('添加 / 管理 MCP');await wait(()=>!!document.querySelector('.wb-mcp-editor'));click('保存并连接');await wait(()=>!!mcpSaved);check(true,'MCP can be configured inline')
 click('Wiki 知识库');check(!!document.querySelector('.kw-original'),'navigation preserves reader mode and location')
 const separator=document.querySelector<HTMLElement>('[aria-label="调整导航宽度"]')!;const before=Number(separator.getAttribute('aria-valuenow'));separator.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await wait(()=>Number(separator.getAttribute('aria-valuenow'))>before);check(true,'keyboard resizing is persisted')
 click('新建专题任务 Ctrl+Shift+N');await wait(()=>!!document.querySelector('.wb-topic-form'));setInput('.wb-topic-form input','毕业论文');click('创建专题与标签')
 await wait(()=>records.size===2&&document.body.textContent!.includes('专题:毕业论文'))
 check(records.get(active)?.topicTag==='专题:毕业论文','new topic creates a matching tag and separate chat')
 click('Wiki 知识库');await wait(()=>!document.querySelector<HTMLElement>('.wb-wiki-page')!.hidden)
 check(!!document.querySelector('.kw-original'),'navigation preserves reader mode and location')
 click('助理');await wait(()=>!!document.querySelector('.wb-message-list'))
 check(document.querySelector<HTMLTextAreaElement>('.wb-composer textarea')!.value.includes('禁止编造'),'assistant restores its own messages and draft')
 click('毕业论文');await wait(()=>document.body.textContent!.includes('专题:毕业论文'))
 check(!document.querySelector('.wb-message-list'),'topic starts with independent history')
 // 后台继续生成：助理任务运行中切到专题，任务照常完成并落盘到助理，专题不受影响
 click('助理');await wait(()=>!!document.querySelector('.wb-message-list'))
 ;(window as any).slowSend=true;setText('.wb-composer textarea','后台任务');await wait(()=>!button('发送消息').disabled);click('发送消息')
 await wait(()=>!!document.querySelector('.wb-run-dot'));click('毕业论文');await wait(()=>document.body.textContent!.includes('正在后台运行'))
 check(button('发送消息').disabled&&!document.querySelector('.wb-message-list'),'topic is viewable while assistant runs in background')
 await wait(()=>!document.querySelector('.wb-run-dot'));await wait(()=>(records.get('assistant').turns as any[]).some(t=>t.content==='后台任务'))
 check((records.get('assistant').turns as any[]).at(-1)?.content.includes('已按任务要求整理'),'background result is saved to its own conversation')
 ;(window as any).slowSend=false
 // 专题管理：右键 → 重命名（Wiki 标签同步）→ 归档/取消归档 → 删除并移除标签
 const topicButton=(title:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('.wb-task-list button')).find(b=>b.textContent?.trim()===title)
 const menuOn=(title:string)=>topicButton(title)!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:60,clientY:400}))
 const enter=(el:Element)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))
 click('新建专题任务 Ctrl+Shift+N');await wait(()=>!!document.querySelector('.wb-topic-form'));setInput('.wb-topic-form input','临时专题');click('创建专题与标签')
 await wait(()=>!!topicButton('临时专题'));note.tags=[...note.tags,'专题:临时专题']
 menuOn('临时专题');await wait(()=>!!document.querySelector('.wb-context-menu'));click('重命名')
 await wait(()=>!!document.querySelector('.wb-rename-input'));setInput('.wb-rename-input','改名专题');enter(document.querySelector('.wb-rename-input')!)
 await wait(()=>!!topicButton('改名专题'))
 check(note.tags.includes('专题:改名专题')&&!note.tags.includes('专题:临时专题')&&document.body.textContent!.includes('同步更新 1 个 Wiki 文件'),'rename syncs the topic tag in Wiki')
 menuOn('改名专题');await wait(()=>!!document.querySelector('.wb-context-menu'));click('归档')
 await wait(()=>!topicButton('改名专题')&&!!document.querySelector('.wb-archive-toggle'))
 document.querySelector<HTMLButtonElement>('.wb-archive-toggle')!.click();await wait(()=>!!topicButton('改名专题'))
 check(topicButton('改名专题')!.classList.contains('is-archived'),'archived topics move to the archive section')
 menuOn('改名专题');await wait(()=>!!document.querySelector('.wb-context-menu'));click('取消归档')
 await wait(()=>!document.querySelector('.wb-archive-toggle'));check(!!topicButton('改名专题'),'unarchive restores the topic')
 menuOn('改名专题');await wait(()=>!!document.querySelector('.wb-context-menu'));click('删除…')
 await wait(()=>!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='删除并移除 Wiki 标签'));click('删除并移除 Wiki 标签')
 await wait(()=>!topicButton('改名专题'))
 check(![...records.values()].some(r=>r.title==='改名专题')&&!note.tags.includes('专题:改名专题')&&note.tags.includes('专题:毕业论文'),'delete removes the topic and only its Wiki tag')
 ;(window as any).showWorkbenchPage=(page:string)=>{click(page);if(page==='Wiki 知识库'){click('详细知识')}}
 return checks
})()
