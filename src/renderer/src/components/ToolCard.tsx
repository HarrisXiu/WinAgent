import { useState } from 'react'
import { ChevronRight, Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { ToolCallView } from '../lib/useAgent'

const SOURCE_LABEL: Record<string, string> = { builtin: '内置', skill: 'Skill', mcp: 'MCP' }

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
    <div className="my-1.5 rounded-lg border border-border bg-bg/60 text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <Wrench className="h-4 w-4 shrink-0 text-accent" />
        <span className="font-mono text-[13px] text-gray-200">{tc.name}</span>
        <span className="rounded bg-border/60 px-1.5 py-0.5 text-[10px] text-muted">
          {SOURCE_LABEL[tc.source] || tc.source}
        </span>
        <span className="ml-auto">
          {tc.running ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : tc.ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">参数</div>
          <pre className="mb-2 overflow-x-auto rounded bg-black/40 p-2 text-[12px] text-gray-300">
            {prettyArgs(tc.args)}
          </pre>
          {tc.result !== undefined && (
            <>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">结果</div>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[12px] ${
                  tc.ok ? 'text-gray-300' : 'text-red-400'
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
