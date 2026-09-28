// Adapted from ZCode WorkspaceShellLayout.tsx (Apache-2.0).
// Upstream: zai-org/ZCode@29628c9acdb81b703bbd4080c207a0e7ce5e276e.
// Changes: extracted into a dependency-free hook, configurable bounds and direction.
import { useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react'

export function useResizablePane(key: string, initial: number, minimum: number, maximum: number, direction = 1) {
  const clamp = (value: number): number => Math.round(Math.max(minimum, Math.min(value, maximum)))
  const [width, setWidth] = useState(() => {
    try { const n = Number(localStorage.getItem(key)); return Number.isFinite(n) && n > 0 ? clamp(n) : initial } catch { return initial }
  })
  const element = useRef<HTMLDivElement>(null)
  const current = useRef(width)
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null)
  const apply = (value: number, persist: boolean): void => {
    current.current = clamp(value)
    element.current?.style.setProperty('--pane-width', `${current.current}px`)
    if (persist) { setWidth(current.current); try { localStorage.setItem(key, String(current.current)) } catch {} }
  }
  const finish = (e: PointerEvent<HTMLDivElement>, cancelled = false): void => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return
    const start = drag.current.width; drag.current = null
    apply(cancelled ? start : current.current, true)
    element.current?.classList.remove('is-resizing')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return { element, style: { '--pane-width': `${width}px` } as CSSProperties, separator: {
    role: 'separator', tabIndex: 0, 'aria-orientation': 'vertical' as const,
    'aria-valuemin': minimum, 'aria-valuemax': maximum, 'aria-valuenow': width,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      drag.current = { pointer: e.pointerId, x: e.clientX, width: current.current }
      element.current?.classList.add('is-resizing'); e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault()
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || drag.current.pointer !== e.pointerId) return
      apply(drag.current.width + direction * (e.clientX - drag.current.x), false)
      e.currentTarget.setAttribute('aria-valuenow', String(current.current)); e.preventDefault()
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => finish(e),
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => finish(e, true),
    onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) => finish(e),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const value = e.key === 'ArrowLeft' ? current.current - 16 * direction : e.key === 'ArrowRight' ? current.current + 16 * direction : e.key === 'Home' ? minimum : e.key === 'End' ? maximum : null
      if (value !== null) { e.preventDefault(); apply(value, true) }
    }
  } }
}
