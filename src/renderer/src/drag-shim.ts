/**
 * 拖放 shim：把 HTML5 拖放事件转成与 Tauri 桥同名自定义事件
 * （'tauri:dragenter' / 'tauri:dragleave' / 'tauri:drop'，detail: { paths: string[] }），
 * App.tsx / WikiLayout.tsx 的既有监听无需改动。
 *
 * Electron 下拖入文件的绝对路径取自 File.path（Electron 扩展属性）。
 */
let dragActive = false

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types || []).includes('Files')
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (!dragActive) {
    dragActive = true
    window.dispatchEvent(new CustomEvent('tauri:dragenter'))
  }
})

window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return
  // 阻止浏览器默认打开文件，并保持 dragover 有效
  e.preventDefault()
})

window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return
  // 离开窗口时相关元素为 null
  if (e.relatedTarget === null) {
    dragActive = false
    window.dispatchEvent(new CustomEvent('tauri:dragleave'))
  }
})

window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragActive = false
  const paths = Array.from(e.dataTransfer?.files || [])
    .map((f) => (f as File & { path?: string }).path)
    .filter((p): p is string => !!p)
  window.dispatchEvent(new CustomEvent('tauri:drop', { detail: { paths } }))
})
