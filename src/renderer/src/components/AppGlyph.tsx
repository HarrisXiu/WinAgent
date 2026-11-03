/** 品牌标识（四角星）：侧栏 logo、欢迎页与启动窗（src/main/splash.html）同形，改形状需三处同步 */
export default function AppGlyph({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c.55 4.9 4.1 8.45 9 9-4.9.55-8.45 4.1-9 9-.55-4.9-4.1-8.45-9-9 4.9-.55 8.45-4.1 9-9Z" />
      <path d="M19 2c.2 1.6 1.4 2.8 3 3-1.6.2-2.8 1.4-3 3-.2-1.6-1.4-2.8-3-3 1.6-.2 2.8-1.4 3-3Z" opacity=".75" />
    </svg>
  )
}
