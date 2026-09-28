import React from 'react'
import {createRoot} from 'react-dom/client'
import App from '../src/renderer/src/App'
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
 send:async(text:string)=>{callback({type:'round',round:1,historyCount:1});await new Promise(r=>setTimeout(r,20));callback({type:'assistant_message',content:'已按任务要求整理，并保留原文证据。'});callback({type:'done'})},
 chats:{list:async()=>[...records.values()].map(({id,title,updated,kind,topicTag})=>({id,title,updated,kind,topicTag})),open:async(id:string)=>{active=id||'assistant';return records.get(active)},createTopic:async(title:string)=>{active=`topic-${++seq}`;const record={id:active,title,kind:'topic',topicTag:`专题:${title}`,updated:new Date().toISOString(),turns:[],state:state()};records.set(active,record);return record},save:async(id:string,turns:any[],context:any,draft:string)=>{const old=records.get(id);records.set(id,{...old,updated:new Date().toISOString(),turns,state:state(),context,draft})}},
 tts:{onSegment:()=>()=>{},onSessionEnd:()=>()=>{},cancel:async()=>{},ack:()=>{}},
 wiki:{sources:async()=>[source],listNotes:async()=>[note],jobs:async()=>[],ruleSets:async()=>[],onVaultChanged:()=>()=>{},onChatContext:()=>()=>{},onIngestProgress:()=>()=>{},readNote:async()=>note,writeNote:async(_path:string,data:any)=>{note.tags=data.tags},deleteNote:async()=>{},pdfData:async()=>makePdf(),openOriginal:async()=>{},pickFiles:async()=>[],listAnalysisTags:async()=>[]}
}
const wait=async(fn:()=>boolean)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI timeout')}
const button=(text:string)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text||b.title===text);if(!b)throw Error('Missing '+text);return b}
const click=(text:string)=>button(text).click()
const setText=(selector:string,value:string)=>{const el=document.querySelector(selector) as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
const setInput=(selector:string,value:string)=>{const el=document.querySelector(selector) as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
const root=createRoot(document.getElementById('root')!)
root.render(<App/> )
;(window as any).workbenchTest=(async()=>{
 const checks:string[]=[];const check=(ok:any,label:string)=>{if(!ok)throw Error(label);checks.push(label)}
 await wait(()=>!!document.querySelector('.wb-new-task')&&!button('新建专题任务 Ctrl+Shift+N').disabled)
 check(document.querySelectorAll('.wb-primary-nav > button').length===4,'assistant, topics, tools and Wiki navigation')
 setText('.wb-composer textarea','整理论文写作计划');await wait(()=>!button('发送消息').disabled);click('发送消息')
 await wait(()=>document.body.textContent!.includes('已按任务要求整理'));await wait(()=>!button('新建专题任务 Ctrl+Shift+N').disabled)
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
 click('专题任务');await wait(()=>document.body.textContent!.includes('专题:毕业论文'))
 check(!document.querySelector('.wb-message-list'),'topic starts with independent history')
 ;(window as any).showWorkbenchPage=(page:string)=>{click(page);if(page==='Wiki 知识库'){click('详细知识')}}
 return checks
})()
