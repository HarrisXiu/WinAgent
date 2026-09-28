const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
const {ConversationStore}=require('../dsh-plugin/lib/agent/ConversationStore')
const {AgentService}=require('../dsh-plugin/lib/agent/AgentService')
const {loadSkills}=require('../dsh-plugin/lib/skills/SkillLoader')
const {ConfigStore,defaultConfig}=require('../dsh-plugin/lib/config/ConfigStore')
async function temp(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'winagent-task-test-'));try{await fn(dir)}finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('winagent-task-test-'));await fs.rm(dir,{recursive:true,force:true})}}
test('conversations restore real model history and rule snapshots after a new store instance',()=>temp(async dir=>{
 const store=new ConversationStore(dir)
 const state={history:[{role:'user',content:'write paper'},{role:'assistant',content:'outline'}],activeRules:[{id:'rule',title:'规范',version:'v1',rules:[{requirement:'不得编造'}]}],usage:{prompt:12,completion:5,total:17,estimated:false}}
 await store.write({id:'one',title:'论文',updated:'2026-09-27',turns:[{id:'turn',role:'user',content:'write paper',toolCalls:[]}],context:{mode:'selected',paths:['wiki/a.md']},draft:'继续',state})
 const reopened=new ConversationStore(dir),record=await reopened.read('one')
 assert.equal((await reopened.list())[0].title,'论文');assert.equal(record.draft,'继续');assert.deepEqual(record.context.paths,['wiki/a.md'])
 const agent=new AgentService({},{});agent.restoreSession(record.state)
 assert.deepEqual(agent.exportSession(),state);agent.restoreSession();assert.equal(agent.getHistory().length,0)
 assert.equal(agent.exportSession().activeRules.length,0);agent.restoreSession(record.state);assert.equal(agent.getUsage().total,17)
 await assert.rejects(reopened.read('../outside'),/ID/)
}))
test('skills can be added as one SKILL.md directory or a parent collection',()=>temp(async dir=>{
 const single=path.join(dir,'one');await fs.mkdir(single)
 await fs.writeFile(path.join(single,'SKILL.md'),'---\nname: research_test\ndescription: Research fixture\n---\nRead supplied sources and cite evidence.')
 assert.equal((await loadSkills(single)).length,1);assert.equal((await loadSkills(dir)).length,1)
}))
test('concurrent settings and output-limit writes leave valid latest config',()=>temp(async dir=>{
 const store=new ConfigStore();store.configPath=path.join(dir,'config.json')
 const cfg=defaultConfig();await Promise.all([store.save({...cfg,maxTokens:100}),store.save({...cfg,maxTokens:200}),store.save({...cfg,maxTokens:300})])
 const disk=JSON.parse(await fs.readFile(store.path,'utf8'));assert.equal(disk.maxTokens,300)
 await assert.rejects(store.save({...cfg,maxTokens:NaN}),/非负整数/)
}))
