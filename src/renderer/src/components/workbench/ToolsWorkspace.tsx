import { useEffect, useState } from 'react'
import { Puzzle, Search, Wrench, Server, FolderOpen, RefreshCw, Plus } from 'lucide-react'
import type { AppConfig, ToolInfo, ToolSource } from '../../../../shared/types'

export default function ToolsWorkspace(): JSX.Element {
  const [tools,setTools]=useState<ToolInfo[]>([])
  const [cfg,setCfg]=useState<AppConfig|null>(null)
  const [query,setQuery]=useState('')
  const [source,setSource]=useState<ToolSource|'all'>('all')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [working,setWorking]=useState(false)
  const [mcp,setMcp]=useState<string|null>(null)
  const names={builtin:'内置工具',skill:'Skills',mcp:'MCP'}
  useEffect(()=>{
    Promise.all([window.winagent.listTools(),window.winagent.getConfig()]).then(([t,c])=>{setTools(t);setCfg(c)}).catch(e=>setError(String(e)))
    return window.winagent.onConfigChanged(c=>{setCfg(c);window.winagent.listTools().then(setTools).catch(e=>setError(String(e)))})
  },[])
  const act=async(fn:()=>Promise<void>):Promise<void>=>{setWorking(true);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setWorking(false)}}
  const addSkills=():void=>{void act(async()=>{
    const dir=await window.winagent.pickDirectory();if(!dir)return
    const current=await window.winagent.getConfig()
    const saved=await window.winagent.saveConfig({...current,skillsDirs:[...new Set([...(current.skillsDirs||[]),dir])]})
    setCfg(saved);setTools(await window.winagent.listTools());setNotice('技能目录已加入并加载。可在下方 Skills 列表查看可用工具。');setSource('skill')
  })}
  const filtered=tools.filter(t=>(source==='all'||t.source===source)&&`${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="wb-market" aria-label="Skills 与 MCP"><header><Puzzle size={22}/><div><h1>Skills 与 MCP</h1><p>添加技能、连接服务，查看 Agent 当前可用的工具。</p></div></header>
    {error&&<p role="alert" className="wb-error">{error}</p>}{notice&&<p role="status" className="wb-muted">{notice}</p>}
    <div className="wb-plugin-grid"><article><FolderOpen size={25}/><small>{tools.filter(t=>t.source==='skill').length} 个工具</small><h2>本地 Skills</h2><p>加入包含 SKILL.md 的技能目录，保留已经加载的目录。</p><button disabled={working} onClick={addSkills}><Plus size={14}/>添加 Skills 目录</button><details><summary className="wb-muted">已配置目录</summary>{[cfg?.skillsDir||'skills',...(cfg?.skillsDirs||[])].map(p=><p key={p} style={{overflowWrap:'anywhere'}}>{p}</p>)}</details></article>
    <article><Server size={25}/><small>{tools.filter(t=>t.source==='mcp').length} 个工具</small><h2>MCP 服务</h2><p>粘贴服务的 mcpServers 配置，支持本地命令和 HTTP 服务。</p><button disabled={working} onClick={()=>void act(async()=>{setMcp(await window.winagent.getMcpConfig())})}><Plus size={14}/>添加 / 管理 MCP</button></article></div>
    {mcp!==null&&<div className="wb-mcp-editor"><h2>MCP 配置</h2><p className="wb-muted">将新服务加入 mcpServers，保存后立即连接。保留已有服务条目即可继续使用。</p><textarea aria-label="MCP JSON 配置" spellCheck={false} value={mcp} onChange={e=>setMcp(e.target.value)}/><button disabled={working} onClick={()=>void act(async()=>{const t=await window.winagent.saveMcpConfig(mcp);setTools(t);setNotice(`配置已保存，当前已加载 ${t.filter(x=>x.source==='mcp').length} 个 MCP 工具。`);setMcp(null);setSource('mcp')})}>保存并连接</button><button disabled={working} onClick={()=>setMcp(null)}>取消</button></div>}
    <div className="kw-actions"><h2>现有工具 · {tools.length}</h2><button disabled={working} onClick={()=>void act(async()=>{setTools(await window.winagent.reloadTools());setNotice('工具列表已重新加载')})}><RefreshCw size={14}/>重新加载</button></div>
    <label className="wb-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索工具名称或功能" aria-label="搜索工具"/></label>
    <div className="wb-tool-filter">{(['all','builtin','skill','mcp'] as const).map(s=><button key={s} aria-pressed={source===s} onClick={()=>setSource(s)}>{s==='all'?'全部':names[s]} · {tools.filter(t=>s==='all'||t.source===s).length}</button>)}</div>
    {filtered.map(t=><details className="wb-tool-row" key={`${t.source}:${t.name}`}><summary><Wrench size={15}/><strong>{t.name}</strong><small>{names[t.source]}{t.dangerous?' · 执行前需确认':''}</small></summary><p>{t.description}</p></details>)}{!filtered.length&&<p className="wb-muted">没有符合条件的工具。添加或连接后点击“重新加载”查看。</p>}
  </section>
}
