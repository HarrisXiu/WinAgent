const {test}=require('node:test')
const assert=require('node:assert/strict')
const {detectOutputLimit,parseOutputLimitError,knownOutputLimit}=require('../dsh-plugin/lib/llm/OutputLimit')
const {chatStream}=require('../dsh-plugin/lib/llm/OpenAIClient')
const provider=model=>({id:model,label:'test',type:'openai',baseUrl:'https://test.invalid/v1',apiKey:'test-key',model})
test('output cap metadata is distinct from context size and cached per model',async()=>{
 const p=provider('metadata');let calls=0
 const fake=async()=>{calls++;return Response.json({data:[{id:p.model,context_length:1000000,top_provider:{max_completion_tokens:32768}}]})}
 assert.equal((await detectOutputLimit(p,fake)).value,32768)
 assert.equal((await detectOutputLimit(p,fake)).value,32768);assert.equal(calls,1)
 assert.equal(knownOutputLimit({...p,model:'different'}),undefined)
 assert.equal(knownOutputLimit({...p,baseUrl:'https://other.invalid'}),undefined)
})
test('missing metadata uses a minimal probe and parses the API advertised bound',async()=>{
 const p=provider('probe');let calls=0
 const result=await detectOutputLimit(p,async(url,init)=>{
  calls++;if(url.endsWith('/models'))return Response.json({data:[{id:p.model,context_length:393216}]})
  const body=JSON.parse(init.body);assert.equal(body.messages.length,1);assert.equal(body.stream,true);assert.equal(body.max_tokens,2147483647);assert.equal(body.tools,undefined)
  return Response.json({error:{message:'Invalid max_tokens value, the valid range of max_tokens is [1, 393216]'}},{status:400})
 })
 assert.equal(result.value,393216);assert.equal(calls,2)
 assert.equal(parseOutputLimitError('context window maximum 1000000'),null)
})
test('Google reads native outputTokenLimit and never confuses inputTokenLimit',async()=>{
 const p={...provider('gemini-test'),baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai/'}
 const result=await detectOutputLimit(p,async(url,init)=>{assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-test');assert.equal(init.headers['x-goog-api-key'],'test-key');return Response.json({inputTokenLimit:1048576,outputTokenLimit:65536})})
 assert.equal(result.value,65536)
})
test('unknown caps are reported as unknown; successful probe stream is cancelled',async()=>{
 let cancelled=false
 const p=provider('unknown')
 const result=await detectOutputLimit(p,async url=>url.endsWith('/models')?Response.json({data:[]}):new Response(new ReadableStream({cancel(){cancelled=true}})))
 assert.equal(result.value,null);assert.equal(cancelled,true)
})
test('400 output bound updates cache and retries before any streamed output',async()=>{
 const old=global.fetch,p=provider('retry');const bodies=[]
 global.fetch=async(_url,init)=>{bodies.push(JSON.parse(init.body));return bodies.length===1?Response.json({error:{message:'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]'}},{status:400}):Response.json({choices:[{message:{content:'OK'},finish_reason:'stop'}]})}
 try{const r=await chatStream(p,[{role:'user',content:'hello'}],{temperature:0,maxTokens:999999,stream:false});assert.equal(r.content,'OK');assert.equal(bodies[1].max_tokens,8192);assert.equal(knownOutputLimit(p).value,8192)}finally{global.fetch=old}
})
test('a rejected advertised boundary uses server default once, with no retry loop',async()=>{
 const old=global.fetch,p=provider('boundary');const bodies=[]
 global.fetch=async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({error:{message:'Invalid max_tokens value, the valid range of max_tokens is [1, 393216]'}},{status:400})}
 try{await assert.rejects(chatStream(p,[{role:'user',content:'hello'}],{temperature:0,maxTokens:393216,stream:false}),/400/);assert.equal(bodies.length,2);assert.equal(bodies[1].max_tokens,undefined)}finally{global.fetch=old}
})
test('invalid numeric options are never serialized as max_tokens null or zero',async()=>{
 const old=global.fetch
 global.fetch=async(_url,init)=>{assert.equal('max_tokens' in JSON.parse(init.body),false);return Response.json({choices:[{message:{content:'OK'}}]})}
 try{for(const maxTokens of [0,-1,NaN,Infinity,1.5])await chatStream(provider('invalid'),[],{temperature:0,maxTokens,stream:false})}finally{global.fetch=old}
})
