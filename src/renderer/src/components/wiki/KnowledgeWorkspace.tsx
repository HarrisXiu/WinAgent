import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, ListChecks, Loader2, Plus, RefreshCw, X, Search, FolderOpen, List, PanelLeftClose, PanelLeftOpen, Trash2 } from 'lucide-react'
import { resolveSidePaneTabsOverflow } from '../workbench/sidePaneLayout'
import type { ConversationSummary, KnowledgeSource, NoteContent, NoteMeta, RuleSet, RuleTask, WikiJob } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/markdown'
import './workspace.css'
import PdfReader from './PdfReader'

export interface KnowledgeSelection { path: string; chunkId?: string }
interface Props {
  selection?: KnowledgeSelection | null
  topicOptions?: ConversationSummary[]
  activeTopicTag?: string
  onPin: (path: string, title: string) => void
  onQuote: (text: string, path: string, title: string) => void
  onClose: () => void
}
const api = () => window.winagent.wiki
const flatten = (notes: NoteMeta[]): NoteMeta[] => notes.flatMap(n => n.kind === 'folder' ? flatten(n.children || []) : [n])
const taskNames: Record<RuleTask, string> = { paper: '论文写作与修改', report: '报告写作', code: '代码开发', all: '所有任务', custom: '自定义关键词' }
const statusNames: Record<string, string> = { indexed:'已可检索', analyzing:'整理中', ready:'整理完成', limited:'解析受限', error:'处理失败', running:'进行中', done:'已完成', cancelled:'已取消', interrupted:'可恢复' }

export default function KnowledgeWorkspace({ selection, topicOptions, activeTopicTag, onPin, onQuote, onClose }: Props): JSX.Element {
  const [view, setView] = useState<'library'|'reader'|'rules'|'jobs'|'topics'>('library')
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [jobs, setJobs] = useState<WikiJob[]>([])
  const [rules, setRules] = useState<RuleSet[]>([])
  const [path, setPath] = useState('')
  const [note, setNote] = useState<NoteContent | null>(null)
  const [mode, setMode] = useState<'knowledge'|'original'|'pdf'>('knowledge')
  const [chunkId, setChunkId] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [task, setTask] = useState<RuleTask>('paper')
  const [keywords, setKeywords] = useState('')
  const [externalTopics, setExternalTopics] = useState<ConversationSummary[]>([])
  const [ruleExpanded, setRuleExpanded] = useState('')
  const [ruleMode, setRuleMode] = useState(false)
  const [tabs, setTabs] = useState<Array<{path:string;title:string}>>([])
  const [explorerOpen,setExplorerOpen] = useState(true)
  const [tabsOverflow,setTabsOverflow] = useState(false)
  const tabBar = useRef<HTMLDivElement>(null)
  const reader = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const refreshRequest = useRef(0)
  const source = sources.find(s => s.sourcePath === path || s.rawPath === path)
  useEffect(()=>{if(!topicOptions)void window.winagent.chats.list().then(setExternalTopics).catch(()=>{})},[topicOptions])
  const refresh = useCallback(async () => {
    const seq = ++refreshRequest.current
    try {
      const [ss, nn, jj, rr] = await Promise.all([api().sources(), api().listNotes(), api().jobs(), api().ruleSets()])
      if(seq!==refreshRequest.current)return
      setSources(ss.sort((a,b)=>b.created.localeCompare(a.created))); setNotes(flatten(nn).filter(n=>n.path.startsWith('wiki/')))
      setJobs(jj.sort((a,b)=>b.updated.localeCompare(a.updated))); setRules(rr)
    } catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void refresh(); return api().onVaultChanged(()=>{ void refresh() }) }, [refresh])
  const open = useCallback(async (p: string, chunk?: string) => {
    const seq = ++request.current
    setPath(p); setView('reader'); setChunkId(chunk || ''); setMode(chunk ? 'original' : 'knowledge'); setNote(null); setError('')
    setTabs(t=>t.some(x=>x.path===p)?t:[...t,{path:p,title:p.split('/').pop()?.replace(/\.md$/,'')||p}])
    try { const n = await api().readNote(p); if (seq === request.current) setNote(n);setTabs(t=>t.map(x=>x.path===p?{...x,title:n.title}:x)) }
    catch (e) { if (seq === request.current) {
      const pending=sources.find(s=>s.sourcePath===p)
      if(pending)setNote({path:p,title:pending.title,tags:[],created:'',updated:'',kind:'file',rawBody:pending.chunks.map(c=>c.text).join(''),links:[],graphExcluded:false})
      setNotice('详细知识尚未生成，可先阅读已解析原文；处理状态见处理记录。')
    } }
  }, [sources])
  useEffect(()=>{
    if(!tabBar.current)return
    const observer=new ResizeObserver(([entry])=>setTabsOverflow(resolveSidePaneTabsOverflow({addButtonInside:false,addButtonWidth:0,tabCount:tabs.length,viewportWidth:entry.contentRect.width})))
    observer.observe(tabBar.current);return()=>observer.disconnect()
  },[tabs.length])
  useEffect(()=>{
    const root=reader.current?.closest('.knowledge-workspace');if(!root)return
    let previous=Infinity
    const observer=new ResizeObserver(([entry])=>{const width=entry.contentRect.width;if(width>0&&width<620&&previous>=620)setExplorerOpen(false);if(width>0)previous=width})
    observer.observe(root);return()=>observer.disconnect()
  },[])
  const closeTab=(p:string):void=>{
    const next=tabs.filter(t=>t.path!==p);setTabs(next)
    if(path===p){if(next.length)void open(next[next.length-1].path);else{request.current++;setPath('');setNote(null);setView('library')}}
  }
  useEffect(()=>{ if(selection) void open(selection.path, selection.chunkId) },[selection, open])
  useEffect(()=>{
    if(!path||source?.status!=='ready')return
    let cancelled=false
    api().readNote(path).then(n=>{if(!cancelled)setNote(n)}).catch(e=>{if(!cancelled)setError(String(e))})
    return ()=>{cancelled=true}
  },[path,source?.status,source?.created])
  useEffect(()=>{
    if(view==='reader' && mode==='original' && chunkId) document.getElementById(`wk-${chunkId}`)?.scrollIntoView({block:'center'})
  },[view,mode,chunkId,source?.id])
  const act = async (fn:()=>Promise<void>): Promise<void> => {
    setWorking(true); setError(''); setNotice('')
    try { await fn(); await refresh() } catch(e) { setError(e instanceof Error ? e.message : String(e)) } finally { setWorking(false) }
  }
  const importFiles = (): void => { void act(async()=>{
    const files = await api().pickFiles()
    if (!files.length) return
    setView('jobs')
    const errors: string[] = []
    for (const file of files) {
      try { const raw = await api().importFile(file, 'raw/imports'); await api().ingest(raw) }
      catch(e) { errors.push(`${file.split(/[\\/]/).pop()}：${String(e)}`) }
    }
    if(errors.length) throw new Error(errors.join('\n'))
    setNotice(`${files.length} 份资料已完成全文整理，可以阅读、提问或启用为规范。`)
  }) }
  const toggleTopic = (tag: string): void => { if(!note)return;void act(async()=>{
    const tags=note.tags.includes(tag)?note.tags.filter(t=>t!==tag):[...note.tags,tag]
    await api().writeNote(note.path,{title:note.title,body:note.rawBody,tags})
    setNote({...note,tags});setNotice(note.tags.includes(tag)?'已移除专题标签':'已加入专题标签')
  }) }
  const deleteCurrent = (): void => {if(!path)return;const title=source?.title||note?.title||path
    if(!window.confirm(`确定删除《${title}》？导入资料会同时删除原文件、分析结果及关联规则。`))return
    void act(async()=>{await api().deleteNote(path);closeTab(path);setNotice(`已删除《${title}》`)})
  }
  const filteredSources=sources.filter(s=>`${s.title} ${s.chunks.map(c=>c.text).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const extraNotes=notes.filter(n=>!sources.some(s=>s.sourcePath===n.path) && n.title.toLowerCase().includes(search.toLowerCase()))
  // ⚠️ 白屏 bug 防回归：本组件在主窗口常驻挂载（App.tsx 仅 display:none 隐藏），这里一抛错整个 App 就白屏。
  // tags 来自用户 YAML，曾混入对象（ANALYSIS_TAGS.md 的 {tag,template}）导致 t.startsWith 崩溃。
  // 服务层 VaultManager.normalizeTags 已保证 string[]，这里的 typeof 守卫是第二道防线，勿删。
  const topics=[...new Set([...(topicOptions||externalTopics).filter(c=>c.kind==='topic').map(c=>c.topicTag||`专题:${c.title}`),...notes.flatMap(n=>(n.tags||[]).filter((t):t is string=>typeof t==='string'&&t.startsWith('专题:')))])]
  return <section className="knowledge-workspace" aria-label="知识工作区">
    <header className="kw-head"><div><strong>知识工作区</strong><small>阅读资料 · 组织知识 · 执行规范</small></div><button aria-label="收起知识工作区" onClick={onClose}><X size={16}/></button></header>
    <div className={`kw-layout ${explorerOpen?'':'kw-explorer-collapsed'}`}>
    <aside className="kw-explorer" aria-label="Wiki 资料导航">
      <div className="kw-explorer-top"><strong><BookOpen size={15}/>Wiki</strong><button title="收起资料列表" onClick={()=>setExplorerOpen(false)}><PanelLeftClose size={15}/></button></div>
      <button className="kw-import" disabled={working} onClick={importFiles}>{working?<Loader2 className="animate-spin" size={15}/>:<Plus size={15}/>}导入资料</button>
      <nav className="kw-nav" aria-label="知识导航">{([['library','资料'],['topics','专题'],['rules','规则'],['jobs','处理记录']] as const).map(([v,l])=><button key={v} aria-current={view===v||(v==='library'&&view==='reader')?'page':undefined} onClick={()=>setView(v)}>{v==='library'?<FolderOpen size={14}/>:v==='rules'?<ListChecks size={14}/>:<List size={14}/>}<span>{l}</span>{v==='jobs'&&jobs.some(j=>j.status==='running')?<i/>:null}</button>)}</nav>
      <label className="kw-search"><Search size={14}/><input aria-label="搜索资料" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索资料与原文"/></label>
      <div className="kw-explorer-caption"><span>资料库 · {sources.length+extraNotes.length}</span><button onClick={()=>void refresh()} aria-label="刷新资料"><RefreshCw size={13}/></button></div>
      <div className="kw-file-list">{filteredSources.map(s=><div className={`kw-row ${path===s.sourcePath?'is-active':''}`} key={s.id}><FileText size={15}/><button className="kw-title-link" onClick={()=>void open(s.sourcePath)} title={s.title}>{s.title}<small>{statusNames[s.status]} · {s.sections.length} 节</small></button><button className="kw-file-pin" title={`对《${s.title}》提问`} onClick={()=>onPin(s.sourcePath,s.title)}><Plus size={13}/></button></div>)}{extraNotes.map(n=><div className={`kw-row ${path===n.path?'is-active':''}`} key={n.path}><FileText size={15}/><button className="kw-title-link" onClick={()=>void open(n.path)} title={n.title}>{n.title}<small>知识笔记</small></button></div>)}{!filteredSources.length&&!extraNotes.length&&<p className="kw-list-empty">{search?'没有匹配的资料':'导入第一份资料，开始建立知识库。'}</p>}</div>
    </aside>
    <div className="kw-main">
      <div className="kw-tabs" ref={tabBar} data-overflow={tabsOverflow}><button className="kw-explorer-toggle" title={explorerOpen?'收起资料列表':'展开资料列表'} onClick={()=>setExplorerOpen(v=>!v)}>{explorerOpen?<PanelLeftClose size={15}/>:<PanelLeftOpen size={15}/>}</button>{tabs.map(t=><div className="kw-tab" key={t.path} data-active={view==='reader'&&path===t.path}><button title={t.title} onClick={()=>void open(t.path)}><FileText size={13}/><span>{t.title}</span></button><button aria-label={`关闭资料 ${t.title}`} onClick={()=>closeTab(t.path)}><X size={12}/></button></div>)}{!tabs.length&&<span className="kw-tabs-placeholder">{view==='rules'?'任务规范':view==='topics'?'研究专题':view==='jobs'?'处理记录':'资料与知识'}</span>}</div>
      {error&&<div role="alert" className="kw-error">{error}</div>}{notice&&<div role="status" className="kw-notice">{notice}<button onClick={()=>setNotice('')} aria-label="关闭提示">×</button></div>}
      <div className="kw-content" ref={reader}>
      {view==='library'&&<div className="kw-library-home"><BookOpen size={36}/><h2>知识，直接用于下一次任务</h2><p>从左侧打开资料。阅读详细知识、核对原文，或将写作规范启用为长期规则。</p><div className="kw-overview"><button onClick={()=>setExplorerOpen(true)}><strong>{sources.length}</strong><span>导入资料</span></button><button onClick={()=>setView('rules')}><strong>{rules.filter(r=>r.enabled).length}</strong><span>已启用规范</span></button><button onClick={()=>setView('jobs')}><strong>{jobs.filter(j=>j.status==='running').length}</strong><span>处理中</span></button></div><button className="kw-primary" disabled={working} onClick={importFiles}><Plus size={15}/>导入资料</button><div className="kw-home-hint"><ListChecks size={17}/><div><strong>例如：让 AI 按你的论文规范写作</strong><p>导入规范 → 打开资料 → 编译并启用规范 → 在对话里发送写作任务。</p></div></div></div>}
      {view==='reader'&&<>
        <div><h2>{source?.title||note?.title||'资料阅读'}</h2><small>{source?`原文版本 ${source.hash.slice(0,12)} · ${statusNames[source.status]}`:path}</small></div>
        <div className="kw-actions"><button aria-pressed={mode==='knowledge'} onClick={()=>setMode('knowledge')}>详细知识</button><button aria-pressed={mode==='original'} disabled={!source} onClick={()=>setMode('original')}>原文与证据</button><button onClick={()=>onPin(path,source?.title||note?.title||path)}>加入当前聊天</button><button onClick={()=>{const panel=reader.current?.querySelector('.kw-rule-setup') as HTMLDetailsElement;if(panel){panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'})}}}><ListChecks size={14}/>作为任务规范</button>{source&&<button onClick={()=>void act(async()=>{await api().openOriginal(source.rawPath)})}>打开原文件</button>}<button className="kw-delete" disabled={working} onClick={deleteCurrent} title="删除 Wiki 文件"><Trash2 size={14}/>删除文件</button></div>
        {source?.rawPath.toLowerCase().endsWith('.pdf')&&<button aria-pressed={mode==='pdf'} onClick={()=>setMode('pdf')}>PDF 原版阅读</button>}
        {mode==='pdf'&&source&&<PdfReader sourceId={source.id}/>}
        {source?.error&&<p className="kw-error">{source.error}</p>}
        {mode==='knowledge'&&<>{note?<div className="kw-reading-layout"><article className="md-body kw-document" dangerouslySetInnerHTML={{__html:renderMarkdown(note.rawBody)}}/><aside className="kw-outline"><strong>本页目录</strong>{[...note.rawBody.matchAll(/^#{1,3} (.+)$/gm)].map((m,i)=><button key={i} onClick={()=>{const heading=Array.from(reader.current?.querySelectorAll('.kw-document h1,.kw-document h2,.kw-document h3')||[])[i];heading?.scrollIntoView({block:'start',behavior:'smooth'})}}>{m[1]}</button>)}</aside></div>:<p>详细知识尚未完成。可以切换原文阅读，并在处理记录中继续任务。</p>}
          {source?.sections.map(s=><details key={s.chunkId}><summary>{s.title} · 原文证据</summary>{s.quotes.map((q,i)=><blockquote key={i}>{q}</blockquote>)}<button onClick={()=>{setChunkId(s.chunkId);setMode('original')}}>定位原文</button></details>)}
        </>}
        {mode==='original'&&source?.chunks.map(c=><article id={`wk-${c.id}`} key={c.id} className={`kw-original ${chunkId===c.id?'kw-highlight':''}`}><div className="kw-actions"><strong>提取文本行 {c.lineStart}–{c.lineEnd}</strong><button onClick={()=>onQuote(window.getSelection()?.toString().trim()||c.text,path,source.title)}>选段加入提问</button></div><pre>{c.text}</pre></article>)}
        <details className="kw-rule-setup"><summary><ListChecks size={16}/> 将这份资料作为任务规范</summary><p>启用后，后续适用任务会自动加载完整规则。普通资料不会自动变成行为指令。</p><label>适用任务<select value={task} onChange={e=>setTask(e.target.value as RuleTask)}>{Object.entries(taskNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{task==='custom'&&<input aria-label="触发关键词" placeholder="关键词，用逗号分隔" value={keywords} onChange={e=>setKeywords(e.target.value)}/>}
          <button disabled={working||(!source?.chunks.length&&!note?.rawBody)} className="kw-primary" onClick={()=>void act(async()=>{const r=await api().compileRules(path,task,keywords.split(/[,，]/));setRuleExpanded(r.id);setView('rules');setNotice(`已启用 ${r.rules.length} 条规则，后续适用任务自动采用。`)})}>{working?'正在核对原文与编译…':'编译并启用规范'}</button></details>
        {note&&<div className="kw-topic-tags"><strong>专题任务标签</strong><p>点击标签将此文件加入或移出专题；可同时属于多个专题。</p><div className="kw-actions">{topics.map(t=><button key={t} aria-pressed={note.tags.includes(t)} disabled={working} onClick={()=>toggleTopic(t)}>{note.tags.includes(t)?'✓ ':''}{t.slice(3)}</button>)}{!topics.length&&<span>先在左侧新建专题任务，再给文件添加标签。</span>}</div>{activeTopicTag&&<small>当前专题：{activeTopicTag}</small>}</div>}
      </>}
      {view==='rules'&&<><h2>持久任务规则</h2><p>启用一次，后续适用任务自动加载。更改只影响新任务；已开始的任务使用原版本。</p>{!rules.length&&<div className="kw-empty">在资料阅读页选择“作为任务规范”，例如论文规范、编码约定或报告要求。</div>}
        {rules.map(r=><article className="kw-rule-card" key={r.id}><div className="kw-actions"><button className="kw-title-link" onClick={()=>setRuleExpanded(ruleExpanded===r.id?'':r.id)}><strong>{r.title}</strong><small>{taskNames[r.task]} · {r.rules.length} 条 · 版本 {r.version}</small></button><button disabled={working} aria-pressed={r.enabled} onClick={()=>void act(()=>api().toggleRules(r.id,!r.enabled))}>{r.enabled?'已启用 · 点击停用':'已停用 · 点击启用'}</button></div>{ruleExpanded===r.id&&<><div className="kw-actions"><button onClick={()=>void open(r.sourcePath)}>查看来源</button><button onClick={()=>setRuleMode(!ruleMode)}>{ruleMode?'阅读版':'模型读取结构'}</button><button onClick={()=>onQuote(`请按 @${r.title} 执行：`,r.sourcePath,r.title)}>带规范提问</button></div>{ruleMode?<pre className="kw-json">{JSON.stringify(r,null,2)}</pre>:r.rules.map(rule=><div className="kw-rule-line" key={rule.id}><strong>{rule.level==='mandatory'?'必须':rule.level==='recommended'?'建议':'可选'} · {rule.requirement}</strong>{rule.condition&&<p>适用条件：{rule.condition}</p>}{rule.exceptions&&<p>例外：{rule.exceptions}</p>}<blockquote>{rule.quote}</blockquote></div>)}</>}</article>)}
      </>}
      {view==='jobs'&&<><h2>处理记录</h2><p>已完成片段保留缓存；中断或失败后可以继续。</p>{!jobs.length&&<p>暂无任务。导入资料后会显示完整处理记录。</p>}{jobs.map(j=><article className="kw-rule-card" key={j.id}><strong>{j.title}</strong><p>{statusNames[j.status]} · {j.stage}</p>{j.total>0&&<p>{j.completed} / {j.total} 个片段</p>}{j.error&&<p className="kw-error">{j.error}</p>}<div className="kw-actions">{j.status==='running'?<button onClick={()=>void act(()=>api().cancelJob(j.id))}>取消此任务</button>:<button disabled={working} onClick={()=>void act(async()=>{await api().ingest(j.rawPath,j.status==='done')})}>{j.status==='done'?'重新分析并覆盖':'重试 / 继续'}</button>}{j.sourcePath&&<button onClick={()=>void open(j.sourcePath!)}>阅读结果</button>}</div></article>)}</>}
      {view==='topics'&&<><h2>专题任务</h2><p>在左侧新建专题任务，再到资料阅读页添加对应标签。专题聊天只使用已标记文件。</p>{!topics.length&&<p>还没有专题任务。请在左侧点击“新建专题任务”。</p>}{topics.map(t=><section className="kw-rule-card" key={t}><h3>{t.slice(3)}</h3>{notes.filter(n=>n.tags.includes(t)).map(n=><div className="kw-row" key={n.path}><button className="kw-title-link" onClick={()=>void open(n.path)}>{n.title}</button><button onClick={()=>onPin(n.path,n.title)}>加入当前聊天</button></div>)}{!notes.some(n=>n.tags.includes(t))&&<p>暂无标记文件。打开资料后点击本专题标签。</p>}</section>)}</>}
    </div>
    </div>
    </div>
  </section>
}
