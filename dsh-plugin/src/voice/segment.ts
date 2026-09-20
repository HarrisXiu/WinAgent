/**
 * 朗读文本分段：把清洗后的纯文本切成适合逐段合成/播放的小段。
 *
 * 目标：首字延迟最小化——首段 ~60 字立刻出声，后续段 ~160 字，硬上限 300 字
 * （超长句先在 `，、` 处二次切分，再不行硬切）。总段数封顶 60：超限时把段落
 * 合并成 ≤60 段（内容不丢，只是单段变大），防止异常长文本打爆请求次数。
 */

/** 首段目标长度（首字延迟关键路径） */
const FIRST_TARGET = 60
/** 后续段目标长度 */
const TARGET = 160
/** 单段硬上限 */
const HARD_MAX = 300
/** 总段数封顶 */
const MAX_SEGMENTS = 60

/** 句末标点 / 换行：一处多断句无妨，聚合阶段会再合并 */
const SENTENCE_BREAK = new Set('。！？；…!?;\n'.split(''))
/** 二次切分点（句内停顿） */
const CLAUSE_BREAK = new Set('，,、：:'.split(''))

/** 按句末标点切句（标点跟随前句） */
function splitSentences(plain: string): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of plain) {
    buf += ch
    if (SENTENCE_BREAK.has(ch)) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/** 超限句在 `，、` 处二次切分，仍超限则硬切 */
function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= HARD_MAX) return [sentence]
  const pieces: string[] = []
  let buf = ''
  for (const ch of sentence) {
    buf += ch
    if (CLAUSE_BREAK.has(ch) && buf.length >= HARD_MAX / 2) {
      pieces.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) pieces.push(buf.trim())
  const out: string[] = []
  for (const p of pieces) {
    if (p.length <= HARD_MAX) {
      out.push(p)
    } else {
      for (let i = 0; i < p.length; i += HARD_MAX) {
        const part = p.slice(i, i + HARD_MAX).trim()
        if (part) out.push(part)
      }
    }
  }
  return out
}

/** 切分朗读文本（输入应先经 plainTextForSpeech 清洗） */
export function splitForSpeech(plain: string): string[] {
  const sentences: string[] = []
  for (const s of splitSentences(plain || '')) sentences.push(...splitLongSentence(s))

  const segments: string[] = []
  let buf = ''
  let target = FIRST_TARGET
  for (const s of sentences) {
    // 加入当前句会明显越过目标（已接近目标 / 突破硬上限）→ 先落盘当前段，
    // 让首段尽量贴着 ~60 字（首字延迟关键路径），后续段贴着 ~160 字
    if (buf && (buf.length + s.length > HARD_MAX || (buf.length + s.length > target && buf.length >= target * 0.8))) {
      segments.push(buf)
      buf = ''
      target = TARGET
    }
    buf += s
    if (buf.length >= target) {
      segments.push(buf)
      buf = ''
      target = TARGET
    }
  }
  if (buf.trim()) segments.push(buf.trim())

  // 段数封顶：合并为 ≤MAX_SEGMENTS 段（内容不丢）
  if (segments.length > MAX_SEGMENTS) {
    const merged: string[] = []
    const per = Math.ceil(segments.length / MAX_SEGMENTS)
    for (let i = 0; i < segments.length; i += per) {
      merged.push(segments.slice(i, i + per).join(''))
    }
    return merged
  }
  return segments
}
