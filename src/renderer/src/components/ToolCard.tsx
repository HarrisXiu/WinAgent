import { useState } from 'react'
import { ChevronRight, Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { ToolCallView } from '../lib/useAgent'

const SOURCE_LABEL: Record<string, string> = { builtin: '内置', skill: 'Skill', mcp: 'MCP' }
const SOURCE_STYLE: Record<string, string> = {
  builtin: 'bg-accent/10 text-accent',
  skill: 'bg-purple-100 text-purple-500',
  mcp: 'bg-cyan-100 text-cyan-600'
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}

export default function ToolCard({ tc }: { tc: ToolCallView }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-border bg-white/70 text-sm transition-colors hover:border-accent/30">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          <Wrench className="h-3.5 w-3.5 text-accent" />
        </span>
        <span className="font-mono text-[13px] text-gray-700">{tc.name}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${SOURCE_STYLE[tc.source] || 'bg-pink-50 text-muted'}`}>
          {SOURCE_LABEL[tc.source] || tc.source}
        </span>
        <span className="ml-auto">
          {tc.running ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          ) : tc.ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-border bg-pink-50/40 px-3 py-2.5">
          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted">参数</div>
          <pre className="mb-2.5 overflow-x-auto rounded-lg border border-border bg-white p-2.5 text-[12px] leading-relaxed text-gray-600">
            {prettyArgs(tc.args)}
          </pre>
          {tc.result !== undefined && (
            <>
              <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted">结果</div>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-white p-2.5 text-[12px] leading-relaxed ${
                  tc.ok ? 'text-gray-600' : 'text-red-500'
                }`}
              >
                {tc.result.slice(0, 4000)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
