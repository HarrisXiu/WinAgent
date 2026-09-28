const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const os=require('node:os')
const path=require('node:path')
const {WorkspaceStore,splitSource,digest}=require('../dsh-plugin/lib/wiki/WorkspaceStore')
const {analyzeDetailed}=require('../dsh-plugin/lib/wiki/DetailedAnalysis')
const {IngestionService}=require('../dsh-plugin/lib/wiki/IngestionService')
const {RuleService,rulesPrompt}=require('../dsh-plugin/lib/wiki/RuleService')
const {SearchIndex}=require('../dsh-plugin/lib/wiki/SearchIndex')
const {KnowledgeRetriever}=require('../dsh-plugin/lib/wiki/KnowledgeRetriever')
const llm=require('../dsh-plugin/lib/llm/OpenAIClient')
const {resetTaskChatMemory}=require('../dsh-plugin/lib/llm/TaskChat')
const provider={id:'offline',label:'test',baseUrl:'http://localhost',model:'fixture',apiKey:''}
const store={activeProvider:()=>provider,get:()=>({knowledgeRag:{enabled:true,topK:4,minScore:0.01}})}
const complete=content=>({content:JSON.stringify(content),toolCalls:[],finishReason:'stop'})
const originalChat=llm.chatStream
async function temporary(fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'winagent-wiki-test-'))
 try{return await fn(dir,new WorkspaceStore(()=>dir))}
 finally{llm.chatStream=originalChat;resetTaskChatMemory();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('winagent-wiki-test-'));await fs.rm(dir,{recursive:true,force:true})}
}
function analysisReply(_provider,messages){
 const text=messages[1].content.split('\n\n').slice(1).join('\n\n')
 return Promise.resolve(complete({title:text.includes('末尾专属知识')?'末尾知识':'章节知识',overview:'章节导读',markdown:`### 详细说明\n${text}\n\n### 条件与局限\n仅适用于提供的材料。`,quotes:[text.trim().slice(0,80)]}))
}

test('lossless chunks preserve long documents, Unicode and stable text anchors',()=>{
 const text=('章节😀：完整条件与参数。\n'.repeat(9000))+'末尾专属知识：温度阈值为 37℃。'
 const chunks=splitSource(text)
 assert.equal(chunks.map(c=>c.text).join(''),text)
 assert.ok(chunks.length>10)
 assert.ok(chunks.at(-1).text.includes('37℃'))
 assert.ok(chunks.every(c=>c.text.length<=5500&&!/[\uD800-\uDBFF]$/.test(c.text)))
 assert.equal(chunks.at(-1).lineEnd,9001)
})

test('full analysis covers tail, caches each chunk across restart, rejects invented evidence',()=>temporary(async(dir,ws)=>{
 const text='前部知识与方法。\n'.repeat(800)+'末尾专属知识：需要检查证据。'
 let calls=0;llm.chatStream=(...args)=>{calls++;return analysisReply(...args)}
 const a=await analyzeDetailed(provider,'长文',text,{workspace:ws})
 assert.equal(a.sections.length,splitSource(text,2400).length)
 assert.match(a.sections.at(-1).markdown,/末尾专属知识/)
 const first=calls
 await analyzeDetailed(provider,'长文',text,{workspace:new WorkspaceStore(()=>dir)})
 assert.equal(calls,first)
 llm.chatStream=async()=>complete({title:'错误',overview:'错误',markdown:'没有原文依据',quotes:['原文不存在的引句']})
 await assert.rejects(()=>analyzeDetailed(provider,'未缓存','新的来源原文'),/原文证据/)
}))

test('truncated document analysis splits the section and keeps verifiable evidence',()=>temporary(async(_dir,ws)=>{
 const raw='APA引用的作者、年份、标题和来源必须按顺序书写。\n'.repeat(38)
 let truncated=0
 llm.chatStream=async(p,m)=>{
  const piece=m[1].content.split('\n\n').slice(1).join('\n\n')
  if(piece.length>400){truncated++;return {content:'{"title":"未完成"',toolCalls:[],finishReason:'length'}}
  return analysisReply(p,m)
 }
 const result=await analyzeDetailed(provider,'APA规范.doc',raw,{workspace:ws})
 assert.ok(truncated>0)
 assert.equal(result.coverage.completed,splitSource(raw,2400).length)
 assert.ok(result.sections.every(s=>s.quotes.length&&s.markdown.includes('APA引用')))
}))

// 回归（2026-09-28）：deepseek-flash 默认深度思考，思考 token 耗尽 max_tokens → finish_reason=length。
// 旧实现对此二分重试最多 6 层（127 次请求）烧光额度，最后报误导性的「输出过短」。
test('truncation caused by reasoning fails fast with a diagnostic instead of splitting',()=>temporary(async(_dir,ws)=>{
 let calls=0
 llm.chatStream=async()=>{calls++;return {content:'',reasoning:'思考'.repeat(4000),toolCalls:[],finishReason:'length',usage:{prompt:1500,completion:6500,total:8000}}}
 await assert.rejects(()=>analyzeDetailed(provider,'APA规范.doc','APA引用规则。\n'.repeat(200),{workspace:ws}),e=>{
  assert.match(e.message,/深度思考耗尽/); assert.match(e.message,/finish_reason=length/); assert.doesNotMatch(e.message,/过短/); return true })
 // 1 次原预算 + 1 次思考余量重试（taskChat），不做二分
 assert.equal(calls,2)
}))

test('persistent truncation is bounded to a few split levels and reports truncation, not short output',()=>temporary(async(_dir,ws)=>{
 let calls=0
 llm.chatStream=async()=>{calls++;return {content:'{"title":"未完',reasoning:'',toolCalls:[],finishReason:'length'}}
 await assert.rejects(()=>analyzeDetailed(provider,'长片段.doc','APA引用的作者、年份、标题和来源必须按顺序书写。\n'.repeat(90),{workspace:ws}),e=>{
  assert.match(e.message,/被截断/); assert.doesNotMatch(e.message,/过短/); return true })
 assert.ok(calls<=4,`截断应在少量请求内失败，实际 ${calls} 次`)
}))

test('topic retrieval excludes untagged Wiki files and assistant sees the full library',()=>temporary(async(_dir,ws)=>{
 const index=new SearchIndex()
 const notes=[{path:'wiki/apa.md',title:'APA',tags:['专题:论文'],rawBody:'APA 引用必须包含作者和年份。'},
  {path:'wiki/private.md',title:'其他资料',tags:['专题:别的任务'],rawBody:'APA 引用可省略年份。'}]
 for(const n of notes) index.indexNote({...n,kind:'file',created:'',updated:''},n.rawBody)
 const vault={getNotesByTag:async tag=>notes.filter(n=>n.tags.includes(tag)),readNote:async p=>notes.find(n=>n.path===p)}
 const retriever=new KnowledgeRetriever(vault,index,store,ws)
 const topic=await retriever.retrieve('APA 引用年份',{topicTag:'专题:论文',mode:'off',paths:['wiki/private.md']})
 assert.ok(topic.references.length)
 assert.ok(topic.references.every(r=>r.path==='wiki/apa.md'))
 assert.ok(!topic.text.includes('可省略年份'))
 const assistant=await retriever.retrieve('APA 引用年份')
 assert.ok(assistant.references.some(r=>r.path==='wiki/private.md'))
}))

test('topic agent blocks Wiki tools even if a model requests one',()=>temporary(async()=>{
 const {AgentService}=require('../dsh-plugin/lib/agent/AgentService')
 let executed=0,called=0
 const cfg={...store.get(),petPrompt:'',compactThresholdTokens:999999,temperature:0,maxTokens:2000,stream:false,autoApproveTools:true}
 const registry={getSchemas:()=>[{name:'read_note'},{name:'write_file'}],getSource:()=> 'builtin',isDangerous:()=>false,execute:async()=>{executed++;return {ok:true,result:'leaked'}}}
 const agent=new AgentService({get:()=>cfg,activeProvider:()=>provider},registry)
 agent.buildUserContent=async(_cfg,_provider,text)=>({content:text,multipart:false,hasFiles:false})
 agent.systemMessage=(_cfg,tag)=>({role:'system',content:tag||''})
 agent.setKnowledgeRetriever({retrieve:async()=>({count:1,references:[],text:'只包含已标记的 APA 规范'})})
 llm.chatStream=async(_provider,_messages,options)=>{called++;assert.deepEqual(options.tools.map(t=>t.name),['write_file']);return called===1?
  {content:'',toolCalls:[{id:'x',name:'read_note',arguments:'{}'}],finishReason:'tool_calls'}:
  {content:'按 APA 规范完成',toolCalls:[],finishReason:'stop'}}
 const events=[]
 await agent.process('写论文',{onEvent:e=>events.push(e),confirmTool:async()=>true},undefined,{topicTag:'专题:论文'})
 assert.equal(executed,0)
 assert.ok(events.some(e=>e.type==='tool_result'&&!e.ok))
 assert.ok(events.some(e=>e.type==='done'))
}))

test('ingestion persists progress, resumes failed chunks, indexes original tail and deduplicates',()=>temporary(async(dir,ws)=>{
 await fs.mkdir(path.join(dir,'raw'),{recursive:true})
 const raw='前部资料。\n'.repeat(1000)+'末尾专属知识：温度阈值为 37℃。'
 await fs.writeFile(path.join(dir,'raw','long.txt'),raw)
 const vault={getVaultPath:()=>dir,readNote:async p=>{const body=await fs.readFile(path.join(dir,p),'utf8');return {path:p,title:'长文',tags:[],rawBody:body}},writeNote:async(p,d)=>{await fs.mkdir(path.dirname(path.join(dir,p)),{recursive:true});await fs.writeFile(path.join(dir,p),d.body)}}
 const index=new SearchIndex();let calls=0,fail=true
 llm.chatStream=(...args)=>{calls++;if(fail&&calls===2)return Promise.reject(new Error('模拟断网'));return analysisReply(...args)}
 const service=new IngestionService(ws,vault,index,store,async()=>'',()=>{},()=>{})
 await assert.rejects(()=>service.run('raw/long.txt'),/模拟断网/)
 assert.equal((await ws.jobs())[0].status,'error')
 assert.equal((await ws.jobs())[0].completed,1)
 assert.equal((await ws.sources())[0].chunks.map(c=>c.text).join(''),raw)
 fail=false;await service.run('raw/long.txt')
 assert.equal(calls,splitSource(raw,2400).length+1)
 assert.equal((await ws.jobs())[0].status,'done')
 await service.run('raw/long.txt');assert.equal(calls,splitSource(raw,2400).length+1)
 const reopened=new WorkspaceStore(()=>dir)
 const refs=await new KnowledgeRetriever(vault,index,store,reopened).retrieve('末尾专属知识 温度阈值')
 assert.ok(refs.references.some(r=>r.excerpt.includes('37℃')))
 assert.match(refs.text,/wiki:/)
 assert.equal(await new KnowledgeRetriever(vault,index,store,reopened).retrieve('温度',{mode:'off'}),null)
 await assert.rejects(()=>service.run('../outside.txt'),/raw/)
}))

test('enabled rules survive restart, match writing rather than reading, preserve all requirements',()=>temporary(async(dir,ws)=>{
 const text='论文必须包含摘要、方法和讨论。\n没有实验数据时必须标记待补充，禁止编造。'
 const vault={readNote:async()=>({title:'论文规范',rawBody:text}),getNotesByTag:async tag=>tag==='专题:论文'?[{path:'wiki/paper-guide.md'}]:[]}
 llm.chatStream=async()=>complete({rules:[{requirement:'包含摘要、方法和讨论',level:'mandatory',condition:'论文写作',exceptions:'',quote:'论文必须包含摘要、方法和讨论。'},{requirement:'没有实验数据时标记待补充，禁止编造',level:'mandatory',condition:'没有实验数据',exceptions:'',quote:'没有实验数据时必须标记待补充，禁止编造。'}]})
 const service=new RuleService(ws,vault)
 const compiled=await service.compile(provider,'wiki/paper-guide.md','paper')
 const restarted=new RuleService(new WorkspaceStore(()=>dir),vault)
 assert.equal((await restarted.resolve('帮我写一篇论文')).length,1)
 assert.equal((await restarted.resolve('帮我写一篇论文',[],'专题:其他')).length,0)
 assert.equal((await restarted.resolve('帮我写一篇论文',[],'专题:论文')).length,1)
 assert.equal((await restarted.resolve('帮我总结这篇论文')).length,0)
 const active=await restarted.resolve('帮我写一篇论文')
 assert.equal((await restarted.resolve('继续展开方法章节',active))[0].version,compiled.version)
 assert.match(rulesPrompt(active),/禁止编造/)
 await restarted.toggle(compiled.id,false)
 assert.equal((await restarted.resolve('写论文')).length,0)
 assert.equal((await restarted.resolve('继续',active)).length,1)
 await restarted.toggle(compiled.id,true)
 llm.chatStream=async()=>complete({checks:[{id:'r-1',status:'pass',reason:'正文有对应章节'}]})
 const report=await restarted.validate(provider,active,'摘要\n方法\n讨论',true)
 assert.equal(report.checks.length,3)
 assert.equal(report.checks[1].status,'review')
 assert.equal(report.checks[2].status,'review')
 assert.equal((await ws.list('tasks')).length,1)
}))

test('deleting a Wiki source removes its raw file, source record, job and compiled rule',()=>temporary(async(dir,ws)=>{
 const {WikiHost}=require('../dsh-plugin/lib/wiki/wiki-host')
 const rel='wiki/sources/paper.md',raw='raw/paper.doc'
 await fs.mkdir(path.join(dir,'wiki/sources'),{recursive:true});await fs.mkdir(path.join(dir,'raw'),{recursive:true})
 await fs.writeFile(path.join(dir,rel),'knowledge');await fs.writeFile(path.join(dir,raw),'original')
 await ws.write('sources','paper',{id:'paper',sourcePath:rel,rawPath:raw})
 await ws.write('jobs','paper',{id:'paper'})
 await ws.write('rules','rule',{id:'rule',sourcePath:rel})
 const host=Object.create(WikiHost.prototype)
 host.workspace=ws;host.vault={getVaultPath:()=>dir,isSystemFile:()=>false,deleteNote:p=>fs.unlink(path.join(dir,p))}
 host.ingestion={active:false};host.search={removeNote:()=>{}};host.bus={push:()=>{}};host.rebuildGraph=async()=>{}
 await host.deleteNote(rel)
 assert.equal((await ws.sources()).length,0);assert.equal((await ws.jobs()).length,0);assert.equal((await ws.rules()).length,0)
 await assert.rejects(()=>fs.access(path.join(dir,raw)),/ENOENT/)
 await assert.rejects(()=>fs.access(path.join(dir,rel)),/ENOENT/)
 await assert.rejects(()=>host.deleteNote('../outside.md'),/只能删除/)
 await fs.writeFile(path.join(dir,raw),'failed import')
 await ws.write('sources','paper',{id:'paper',sourcePath:rel,rawPath:raw})
 await host.deleteNote(rel)
 assert.equal((await ws.sources()).length,0)
 await assert.rejects(()=>fs.access(path.join(dir,raw)),/ENOENT/)
}))

test('Agent reinjects rules on every tool round and after compaction; reset removes task snapshot',()=>temporary(async(dir,ws)=>{
 const {AgentService}=require('../dsh-plugin/lib/agent/AgentService')
 const {ContextManager}=require('../dsh-plugin/lib/agent/ContextManager')
 const compact=ContextManager.prototype.compact
 ContextManager.prototype.compact=async function(historyProvider,history){return history.slice(-1)}
 const cfg={...store.get(),compactThresholdTokens:1,temperature:0,maxTokens:2000,stream:false,autoApproveTools:true}
 const agent=new AgentService({get:()=>cfg,activeProvider:()=>provider},{getSchemas:()=>[],getSource:()=>({type:'builtin'}),isDangerous:()=>false,execute:async()=>({ok:true,result:'fixture'})})
 agent.systemMessage=()=>({role:'system',content:'助手'})
 agent.buildUserContent=async(_cfg,_provider,text)=>({content:text,multipart:false,hasFiles:false})
 const set={id:'paper',title:'论文规范',version:'v1',sourcePath:'guide',sourceHash:'x',task:'paper',keywords:[],enabled:true,created:'now',rules:[{id:'r1',requirement:'必须保留实验缺口',level:'mandatory',condition:'',exceptions:'',quote:'必须保留实验缺口',chunkId:'part-1'}]}
 await ws.write('rules','paper',set)
 const service={resolve:async text=>text.includes('总结')?[]:[set],recordTask:async()=>{},validate:async()=>({id:'r',created:'now',sets:[],checks:[],scope:'正文'})}
 agent.setRuleService(service)
 const requests=[];let count=0
 llm.chatStream=async(_provider,messages)=>{requests.push(messages);count++;return count===1?{content:'读取资料',toolCalls:[{id:'t1',name:'read_note',arguments:'{}'}],finishReason:'tool_calls'}:{content:'论文正文：实验待补充',toolCalls:[],finishReason:'stop'}}
 const events=[]
 try{
   await agent.process('写一篇论文',{onEvent:e=>events.push(e),confirmTool:async()=>true})
   assert.equal(requests.length,2)
   assert.ok(requests.every(r=>r[0].content.includes('必须保留实验缺口')))
   assert.ok(events.some(e=>e.type==='rule_report'))
   assert.ok(events.some(e=>e.type==='compact'))
   agent.reset();await agent.process('总结这篇论文',{onEvent:()=>{},confirmTool:async()=>true})
   assert.ok(!requests.at(-1)[0].content.includes('必须保留实验缺口'))
 }finally{ContextManager.prototype.compact=compact}
}))

test('interrupted jobs are recoverable after restart',()=>temporary(async(dir,ws)=>{
 await ws.write('jobs','incomplete',{id:'incomplete',status:'running',stage:'分析',completed:2,total:5})
 await new WorkspaceStore(()=>dir).recover()
 assert.equal((await ws.jobs())[0].status,'interrupted')
 assert.equal((await ws.jobs())[0].completed,2)
}))

test('cancelling one import does not cancel another source',()=>temporary(async(dir,ws)=>{
 await fs.mkdir(path.join(dir,'raw'),{recursive:true})
 await fs.writeFile(path.join(dir,'raw/a.txt'),'A source evidence')
 await fs.writeFile(path.join(dir,'raw/b.txt'),'B source evidence')
 const vault={getVaultPath:()=>dir,readNote:async()=>{throw Error('not yet')},writeNote:async(p,d)=>{await fs.mkdir(path.dirname(path.join(dir,p)),{recursive:true});await fs.writeFile(path.join(dir,p),d.body)}}
 let waitingA
 const startedA=new Promise(r=>waitingA=r)
 llm.chatStream=async(p,m,options)=>{
  if(m[1].content.includes('A source')){
   waitingA()
   await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))
  }
  return analysisReply(p,m)
 }
 const service=new IngestionService(ws,vault,new SearchIndex(),store,async()=>'',()=>{},()=>{})
 const a=service.run('raw/a.txt');const rejection=assert.rejects(a,/已取消/)
 await startedA
 const b=service.run('raw/b.txt')
 service.cancel(digest('raw/a.txt').slice(0,24))
 await rejection;await b
 const jobs=await ws.jobs()
 assert.equal(jobs.find(j=>j.rawPath==='raw/a.txt').status,'cancelled')
 assert.equal(jobs.find(j=>j.rawPath==='raw/b.txt').status,'done')
}))

test('empty scanned extraction does not become completed knowledge',()=>temporary(async(dir,ws)=>{
 await fs.mkdir(path.join(dir,'raw'),{recursive:true});await fs.writeFile(path.join(dir,'raw/scan.pdf'),'PDF fixture')
 const vault={getVaultPath:()=>dir,readNote:async()=>{throw Error('missing')},writeNote:async()=>{throw Error('must not write knowledge')}}
 const service=new IngestionService(ws,vault,new SearchIndex(),store,async()=>'【PDF 第 1 页】\n【本页未提取到文字，需要 OCR 或核对原页】',()=>{},()=>{})
 await assert.rejects(()=>service.run('raw/scan.pdf'),/OCR/)
 assert.equal((await ws.sources())[0].status,'limited')
 assert.equal((await ws.sources())[0].sections.length,0)
}))

test('PDF extraction retains actual page labels and text',()=>temporary(async(dir)=>{
 const {makePdf}=require('./pdf-fixture.cjs')
 const {extractByFormat}=require('../dsh-plugin/assets/skills/pdf/extract.js')
 const file=path.join(dir,'fixture.pdf');await fs.writeFile(file,makePdf())
 const text=await extractByFormat(file,'pdf')
 assert.match(text,/PDF 第 1 页/)
 assert.match(text,/WinAgent PDF reading fixture/)
}))
