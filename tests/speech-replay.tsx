import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeechProvider, useSpeech, type SpeechApi } from '../src/renderer/src/lib/useSpeech'

// Deterministic media timing lets a segment finish before the next TTS result arrives.
class FakeAudio extends EventTarget {
  static active: FakeAudio | null = null
  src: string
  preload = ''
  error: { message: string } | null = null
  constructor(url: string) { super(); this.src = url }
  play() { FakeAudio.active = this; return Promise.resolve() }
  pause() { if (FakeAudio.active === this) FakeAudio.active = null }
  load() {}
  removeAttribute() { this.src = '' }
}

Object.assign(globalThis, { Audio: FakeAudio, IS_REACT_ACT_ENVIRONMENT: true })

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function fixture(run: (f: any) => Promise<void>) {
  let api: SpeechApi
  let onSegment: (event: any) => void
  let onEnd: (event: any) => void
  let onConfig: (config: any) => void
  let starts = 0
  let total = 1
  const acks: number[] = []
  const config = { voice: { voice: 'mimo_default', stylePrompt: '', outputFormat: 'wav' } }
  Object.assign(window, { winagent: {
    getConfig: async () => config,
    onConfigChanged: (cb: typeof onConfig) => { onConfig = cb; return () => {} },
    tts: {
      start: async () => ({ sessionId: `session-${++starts}`, total }),
      cancel: () => {},
      ack: (_id: string, index: number) => acks.push(index),
      onSegment: (cb: typeof onSegment) => { onSegment = cb; return () => {} },
      onSessionEnd: (cb: typeof onEnd) => { onEnd = cb; return () => {} }
    }
  } })
  function Probe() { api = useSpeech(); return null }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<SpeechProvider><Probe /></SpeechProvider>))
  const f = {
    get api() { return api! },
    get starts() { return starts },
    acks,
    setTotal: (n: number) => { total = n },
    speak: (text = 'hello', voice?: string) => act(async () => api.speak(text, { messageId: 'message-1', voice })),
    stop: () => act(async () => api.stop()),
    segment: (index: number, sessionId = `session-${starts}`) => act(async () => onSegment({
      sessionId, index, total, mime: 'audio/wav', audioBase64: `segment-${index}`
    })),
    endAudio: () => act(async () => {
      if (!FakeAudio.active) throw new Error('Expected playing audio')
      FakeAudio.active.dispatchEvent(new Event('ended'))
    }),
    fail: () => act(async () => onEnd({ sessionId: `session-${starts}`, total, error: 'synthesis failed' })),
    configure: (update: object) => act(async () => { Object.assign(config.voice, update); onConfig(config) })
  }
  try { await run(f) } finally {
    await act(async () => { api.stop(); root.unmount() })
    container.remove()
  }
}

const cases: [string, (f: any) => Promise<void>][] = [
  ['slow synthesis keeps the session and replays the complete message without TTS', async f => {
    f.setTotal(4)
    await f.speak()
    for (let i = 0; i < 4; i++) {
      await f.segment(i)
      equal(f.api.index, i + 1, 'visible segment index')
      await f.endAudio()
      equal(f.api.state, i === 3 ? 'idle' : 'loading', 'state after segment ends')
    }
    equal(f.acks, [0, 1, 2, 3], 'prefetch acknowledgements across empty queues')
    for (let replay = 0; replay < 2; replay++) {
      await f.speak()
      equal(f.starts, 1, 'TTS start count on replay')
      for (let i = 0; i < 4; i++) {
        equal(FakeAudio.active?.src, `data:audio/wav;base64,segment-${i}`, 'cached audio order')
        await f.endAudio()
      }
      equal(f.api.state, 'idle', 'replay finishes')
    }
    equal(f.acks, [0, 1, 2, 3], 'cached playback sends no server acknowledgements')
  }],
  ['single segment playback reuses its audio', async f => {
    await f.speak(); await f.segment(0); await f.endAudio(); await f.speak()
    equal(f.starts, 1, 'single segment TTS start count')
    await f.endAudio()
    equal(f.api.state, 'idle', 'single segment replay ends')
  }],
  ['fully synthesized audio survives stopping before playback finishes', async f => {
    f.setTotal(3)
    await f.speak()
    for (let i = 0; i < 3; i++) await f.segment(i)
    await f.stop(); await f.speak()
    equal(f.starts, 1, 'stop preserves complete synthesis')
    for (let i = 0; i < 3; i++) await f.endAudio()
  }],
  ['partial and failed synthesis are not cached and stale results are ignored', async f => {
    f.setTotal(2)
    await f.speak(); await f.segment(0); await f.endAudio(); await f.stop()
    await f.segment(1, 'session-1')
    equal(f.api.state, 'idle', 'late cancelled segment is ignored')
    await f.speak()
    equal(f.starts, 2, 'partial synthesis must restart')
    await f.segment(0); await f.endAudio(); await f.fail()
    equal(f.api.state, 'idle', 'failure while awaiting next segment finishes')
    await f.speak()
    equal(f.starts, 3, 'failed synthesis must restart')
  }],
  ['changed text or voice settings require fresh synthesis', async f => {
    await f.speak(); await f.segment(0); await f.endAudio()
    await f.speak('changed'); equal(f.starts, 2, 'changed text')
    await f.segment(0); await f.endAudio()
    await f.speak('changed', 'new-voice'); equal(f.starts, 3, 'changed voice')
    await f.segment(0); await f.endAudio()
    await f.configure({ stylePrompt: 'happy' })
    await f.speak('changed', 'new-voice'); equal(f.starts, 4, 'changed style')
    await f.segment(0); await f.endAudio()
    await f.configure({ outputFormat: 'mp3' })
    await f.speak('changed', 'new-voice'); equal(f.starts, 5, 'changed format')
  }]
]

Object.assign(globalThis, { speechTestResult: (async () => {
  const results: string[] = []
  for (const [name, run] of cases) {
    await fixture(run)
    results.push(`PASS ${name}`)
  }
  return results
})() })
