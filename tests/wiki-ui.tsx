import React from 'react'
import {createRoot} from 'react-dom/client'
import KnowledgeWorkspace from '../src/renderer/src/components/wiki/KnowledgeWorkspace'
import {renderMarkdown} from '../src/renderer/src/lib/markdown'
import {makePdf} from './pdf-fixture.cjs'

const source={id:'source1',title:'论文写作规范.pdf',rawPath:'raw/guide.pdf',hash:'abc123',sourcePath:'wiki/sources/guide.md',created:'2026-09-27',status:'ready',chunks:[{id:'part-1',text:'论文必须包含摘要、方法和讨论。没有实验数据时应标记待补充，禁止编造。',lineStart:1,lineEnd:2}],sections:[{chunkId:'part-1',title:'论文的结构与证据要求',overview:'保留规定章节与实验缺口',markdown:'详细说明',quotes:['没有实验数据时应标记待补充，禁止编造。']}]}
const note={path:source.sourcePath,title:source.title,kind:'file',created:'2026-09-27',updated:'2026-09-27',tags:['专题:毕业论文'],links:[],rawBody:'# 论文写作规范\n\n## 结构与证据\n\n论文必须包含摘要、方法和讨论。没有数据时保留待补充项，不编造实验结论。\n\n### 适用条件\n\n撰写与修改论文时适用，解释文献内容时不套用全文格式。'}
const rule={id:'rules1',title:source.title,sourcePath:source.sourcePath,sourceHash:'abc123',version:'a1',task:'paper',keywords:[],enabled:true,created:'2026-09-27',rules:[{id:'r1',requirement:'没有实验数据时标记待补充，禁止编造',level:'mandatory',condition:'没有实验数据',exceptions:'',quote:source.chunks[0].text,chunkId:'part-1'}]}
const rules:any[]=[]
const pins:any[]=[],quotes:any[]=[]
let deleted=false
const wiki={sources:async()=>deleted?[]:[source],listNotes:async()=>deleted?[]:[note],jobs:async()=>[{id:'job1',title:source.title,rawPath:source.rawPath,status:'done',stage:'全文整理完成',completed:1,total:1,updated:'2026-09-27',sourcePath:source.sourcePath}],ruleSets:async()=>rules,onVaultChanged:()=>()=>{},readNote:async()=>note,compileRules:async()=>{rules.push(rule);return rule},toggleRules:async(id:string,enabled:boolean)=>{rules.find(r=>r.id===id).enabled=enabled},writeNote:async(_path:string,data:any)=>{note.tags=data.tags},deleteNote:async()=>{deleted=true},openOriginal:async()=>{},pdfData:async()=>makePdf(),pickFiles:async()=>[],cancelJob:async()=>{},ingest:async()=>({})}
;(window as any).winagent={wiki,chats:{list:async()=>[{id:'topic-1',title:'毕业论文',kind:'topic',topicTag:'专题:毕业论文',updated:'now'}]}}
const wait=async(fn:()=>boolean)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI condition timed out')}
const click=(text:string)=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text);if(!button)throw Error('Missing button '+text);button.click()}
const root=createRoot(document.getElementById('root')!)
root.render(<KnowledgeWorkspace onClose={()=>{}} onPin={(...a)=>pins.push(a)} onQuote={(...a)=>quotes.push(a)}/>)
;(window as any).wikiUITest=(async()=>{
 const checks:string[]=[]
 const check=(ok:any,label:string)=>{if(!ok)throw Error(label);checks.push(label)}
 await wait(()=>!!document.querySelector('.kw-row'))
 ;(document.querySelector('.kw-title-link') as HTMLButtonElement).click()
 await wait(()=>!!document.querySelector('.kw-document'))
 check(document.body.textContent?.includes('适用条件'),'detailed reader')
 click('原文与证据');await wait(()=>!!document.querySelector('.kw-original'))
 click('选段加入提问');check(quotes[0]?.[0].includes('禁止编造'),'original quote to same conversation')
 click('加入当前聊天');check(pins[0]?.[0]===source.sourcePath,'pin source')
 ;(document.querySelector('.kw-rule-setup') as HTMLDetailsElement).open=true
 click('编译并启用规范');await wait(()=>!!document.querySelector('.kw-rule-card'))
 check(document.body.textContent?.includes('已启用 · 点击停用'),'rule enabled')
 click('模型读取结构');await wait(()=>!!document.querySelector('.kw-json'))
 check(document.querySelector('.kw-json')?.textContent?.includes('mandatory'),'machine and human rule views')
 click('已启用 · 点击停用');await wait(()=>document.body.textContent!.includes('已停用 · 点击启用'))
 check(!rules[0].enabled,'rule toggle persisted')
 click('处理记录');await wait(()=>document.body.textContent!.includes('全文整理完成'));check(true,'durable job UI')
 click('专题');await wait(()=>document.body.textContent!.includes('毕业论文'));check(true,'topic members')
 ;(document.querySelector('.kw-title-link') as HTMLButtonElement).click()
 await wait(()=>!!document.querySelector('.kw-document'))
 const html=renderMarkdown('<img src=x onerror="alert(1)"><script>alert(1)</script>[bad](javascript:alert(1))')
 check(!html.includes('onerror')&&!html.includes('<script')&&!html.includes('javascript:'),'imported markdown sanitized')
 ;(window as any).deleteWikiFileTest=async()=>{(window as any).confirm=()=>true;click('删除文件');await wait(()=>deleted);return deleted}
 return checks
})()
