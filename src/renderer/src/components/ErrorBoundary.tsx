import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 渲染错误边界。
 *
 * ⚠️ 白屏 bug 防回归（2026-09-27）：React 18 中任何组件渲染时抛出的异常，若无错误边界接住，
 * 会卸载整棵组件树 → 窗口只剩 index.html 的空 #root → 「启动白屏」。
 * 该问题已多次复发（原因各不相同：IPC 桥未就绪、dev server 连接被拒、YAML tags 混入对象……），
 * 所以在 main.tsx 根部与常驻挂载的面板外层都包一层边界：出错时显示错误信息 + 重载按钮，
 * 而不是一片空白，定位问题只需看界面上的报错。**不要移除 main.tsx 里的根边界。**
 */
interface Props {
  children: ReactNode
  /** 出错区域名称（显示在错误面板上，便于定位） */
  name?: string
  /** 局部边界：只替换出错的这一块，不占满整个窗口 */
  inline?: boolean
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info.componentStack)
  }

  private retry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const title = this.props.name ? `「${this.props.name}」渲染出错` : '界面渲染出错'
    return (
      <div
        role="alert"
        className={
          this.props.inline
            ? 'm-4 rounded-xl border border-danger/40 bg-panel p-4 text-sm text-text'
            : 'flex h-screen flex-col items-center justify-center gap-3 bg-bg p-8 text-center text-sm text-text'
        }
      >
        <div className="font-semibold text-danger">{title}</div>
        <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-3 py-2 text-left text-xs text-muted">
          {error.message || String(error)}
        </pre>
        <div className="flex gap-2">
          <button className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface-hover" onClick={this.retry}>
            重试
          </button>
          {!this.props.inline && (
            <button className="rounded-lg bg-accent px-3 py-1.5 text-accent-fg" onClick={() => window.location.reload()}>
              重新加载窗口
            </button>
          )}
        </div>
      </div>
    )
  }
}
