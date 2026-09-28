// 回归（v0.5.1）：后台任务模型调用统一出口 taskChat。
// 事故：deepseek-flash 默认深度思考，思考 token 耗尽 max_tokens → 截断/空正文，
// 导致 Wiki 分析烧光额度失败、上下文压缩把空摘要当历史（静默丢失对话）等一类问题。
const {test,beforeEach}=require('node:test')
const assert=require('node:assert/strict')
const llm=require('../dsh-plugin/lib/llm/OpenAIClient')
const {rememberOutputLimit}=require('../dsh-plugin/lib/llm/OutputLimit')
const {taskChat,ModelOutputError,REASONING_HEADROOM,modelThinksAnyway,resetTaskChatMemory}=require('../dsh-plugin/lib/llm/TaskChat')
const {ContextManager}=require('../dsh-plugin/lib/agent/ContextManager')

const originalChat=llm.chatStream
let seq=0
const provider=()=>({id:'p',label:'test',type:'openai',baseUrl:`http://model-${++seq}.test/v1`,model:'thinker',apiKey:''})
const msgs=[{role:'user',content:'任务'}]
const reply=(o)=>({content:'',reasoning:'',toolCalls:[],finishReason:'stop',...o})
function mockChat(replies){
 const calls=[]
 llm.chatStream=async(_p,_m,opts)=>{calls.push(opts);const r=replies[Math.min(calls.length-1,replies.length-1)];return typeof r==='function'?r(opts):r}
 return calls
}
beforeEach(()=>{llm.chatStream=originalChat;resetTaskChatMemory()})

test('background tasks always request thinking off',async()=>{
 const calls=mockChat([reply({content:'{"ok":true}'})])
 await taskChat(provider(),msgs,{purpose:'测试',temperature:0,maxTokens:1000})
 assert.equal(calls[0].thinking,'off')
 assert.equal(calls[0].maxTokens,1000)
 assert.equal(calls[0].stream,false)
})

test('reasoning-exhausted budget is retried once with headroom and the model is remembered',async()=>{
 const p=provider()
 const calls=mockChat([reply({reasoning:'思'.repeat(9000),finishReason:'length'}),reply({content:'结果',reasoning:'思'.repeat(9000)})])
 const r=await taskChat(p,msgs,{purpose:'测试',temperature:0,maxTokens:1000})
 assert.equal(r.content,'结果')
 assert.deepEqual(calls.map(c=>c.maxTokens),[1000,1000+REASONING_HEADROOM])
 assert.ok(modelThinksAnyway(p))
 // 之后的调用直接带余量，不再先撞一次截断
 const next=mockChat([reply({content:'第二个任务'})])
 await taskChat(p,msgs,{purpose:'测试',temperature:0,maxTokens:500})
 assert.equal(next[0].maxTokens,500+REASONING_HEADROOM)
})

test('reasoning that exhausts even the headroom fails with a diagnostic, never "too short"',async()=>{
 const calls=mockChat([reply({reasoning:'思'.repeat(30000),finishReason:'length',usage:{prompt:1,completion:9999,total:10000}})])
 await assert.rejects(()=>taskChat(provider(),msgs,{purpose:'Wiki 详细分析 part-1 ',temperature:0,maxTokens:6500}),e=>{
  assert.ok(e instanceof ModelOutputError); assert.equal(e.kind,'reasoning')
  assert.match(e.message,/深度思考耗尽/); assert.match(e.message,/finish_reason=length/); assert.match(e.message,/9999 tokens/)
  assert.doesNotMatch(e.message,/过短/); return true })
 assert.equal(calls.length,2)
})

test('headroom retry is skipped when the known output limit leaves no room to grow',async()=>{
 const p=provider()
 await rememberOutputLimit(p,1000,'测试')
 const calls=mockChat([reply({reasoning:'思'.repeat(9000),finishReason:'length'})])
 await assert.rejects(()=>taskChat(p,msgs,{purpose:'测试',temperature:0,maxTokens:1000}),e=>e.kind==='reasoning')
 assert.equal(calls.length,1)
})

test('empty content is never returned as success',async()=>{
 mockChat([reply({content:'  '})])
 await assert.rejects(()=>taskChat(provider(),msgs,{purpose:'AI 问答',temperature:0,maxTokens:1000}),e=>e instanceof ModelOutputError&&e.kind==='empty'&&/空内容/.test(e.message))
})

test('plain truncation throws unless the caller opts in to split it',async()=>{
 mockChat([reply({content:'{"title":"未完',finishReason:'length'})])
 await assert.rejects(()=>taskChat(provider(),msgs,{purpose:'规范编译 part-1 ',temperature:0,maxTokens:1000}),e=>e.kind==='length'&&/被截断/.test(e.message))
 const r=await taskChat(provider(),msgs,{purpose:'测试',temperature:0,maxTokens:1000,allowTruncated:true})
 assert.equal(r.finishReason,'length')
})

test('context compaction keeps the original history when the summary comes back empty',async()=>{
 const cfg={keepRecentTurns:1,compactThresholdTokens:10,stream:false}
 const history=[]
 for(let i=0;i<8;i++) history.push({role:'user',content:`问题 ${i} `+'内容'.repeat(200)},{role:'assistant',content:`回答 ${i} `+'内容'.repeat(200)})
 mockChat([reply({reasoning:'思'.repeat(30000),finishReason:'length'})])
 const out=await new ContextManager(cfg).compact(provider(),history)
 assert.ok(!out.some(m=>typeof m.content==='string'&&m.content.startsWith('【历史摘要】')),'空摘要不得替换历史')
 assert.equal(out.length,history.length)
})
