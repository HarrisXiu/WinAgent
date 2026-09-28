import KnowledgeWorkspace from './KnowledgeWorkspace'

/** Optional second-screen reader; all questions return to the main conversation. */
export default function WikiWindowApp(): JSX.Element {
  return <div className="h-screen"><KnowledgeWorkspace onClose={()=>window.close()}
    onPin={(path,title)=>void window.winagent.wiki.returnToChat({path,title})}
    onQuote={(text,path,title)=>void window.winagent.wiki.returnToChat({path,title,text})}/></div>
}
