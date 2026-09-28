import {useEffect,useRef,useState} from 'react'
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc=new URL(workerUrl,document.baseURI).href

export default function PdfReader({sourceId}:{sourceId:string}):JSX.Element {
  const [documentPdf,setDocumentPdf]=useState<PDFDocumentProxy|null>(null)
  const [page,setPage]=useState(1)
  const [scale,setScale]=useState(1.3)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    let cancelled=false,task:ReturnType<typeof getDocument>|undefined
    setError('');setDocumentPdf(null);setPage(1);setLoading(true)
    window.winagent.wiki.pdfData(sourceId).then(bytes=>{
      if(cancelled)return
      task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false})
      return task.promise.then(pdf=>{if(!cancelled)setDocumentPdf(pdf)})
    }).catch(e=>{if(!cancelled){setError(String(e));setLoading(false)}})
    return ()=>{cancelled=true;void task?.destroy()}
  },[sourceId])
  useEffect(()=>{
    if(!documentPdf||!canvas.current)return
    let cancelled=false,render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined
    setLoading(true);setError('')
    documentPdf.getPage(page).then(p=>{
      if(cancelled||!canvas.current)return
      const viewport=p.getViewport({scale})
      canvas.current.width=Math.ceil(viewport.width);canvas.current.height=Math.ceil(viewport.height)
      render=p.render({canvasContext:canvas.current.getContext('2d')!,viewport})
      return render.promise
    }).then(()=>{if(!cancelled)setLoading(false)}).catch(e=>{if(!cancelled){setError(String(e));setLoading(false)}})
    return ()=>{cancelled=true;render?.cancel()}
  },[documentPdf,page,scale])
  return <div className="kw-pdf"><div className="kw-actions"><button disabled={!documentPdf||page<=1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page} / {documentPdf?.numPages||'…'} 页</span><button disabled={!documentPdf||page>=documentPdf.numPages} onClick={()=>setPage(p=>p+1)}>下一页</button><label>清晰度 <select value={scale} onChange={e=>setScale(Number(e.target.value))}><option value={1}>标准</option><option value={1.3}>清晰</option><option value={2}>高清</option></select></label></div>{loading&&<p role="status">正在渲染原始页面…</p>}{error&&<p role="alert" className="kw-error">{error}，可使用“打开原文件”。</p>}<canvas ref={canvas} aria-label={`PDF 原文第 ${page} 页`} className="w-full rounded border border-border" style={{background:'#fff',display:error?'none':'block'}}/></div>
}
