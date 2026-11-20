import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechToText } from '../hooks/use-speech-to-text'
import { useNpcVoice } from '../hooks/use-npc-voice'
import { PracticeResults } from '../components/practice-results'
import type { ScenarioSummary } from '../types/scenario'
import {
  PracticeError, finishSession, readSession, sendMessage, startSession, updatePracticeURL,
  type Session, type TurnSubmission,
} from '../services/practice'

const maxMessageLength = 1000
const isTooLong = (text: string) => Array.from(text).length > maxMessageLength

export function Practice({ scenario, exit }: { scenario: ScenarioSummary; exit: () => void }) {
  const { id: scenarioId, character = 'คู่สนทนา' } = scenario
  const restoredId = useRef(new URLSearchParams(window.location.search).get('session'))
  const operation = useRef<AbortController | null>(null)
  const pending = useRef<TurnSubmission | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [busy, setBusy] = useState(Boolean(restoredId.current))
  const [error, setError] = useState('')
  const [unsentReply, setUnsentReply] = useState<string | null>(null)
  const voice = useNpcVoice(scenarioId)

  const speech = useSpeechToText((transcript) => {
    setError('')
    setUnsentReply(transcript)
    send(transcript)
  })

  const run = useCallback(async (
    action: (signal: AbortSignal) => Promise<Session>,
    failure: string,
    onSuccess?: (next: Session) => void,
  ) => {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      const next = await action(controller.signal)
      if (controller.signal.aborted) return
      if (next.scenarioId !== scenarioId) throw new PracticeError(404)
      if (pending.current && next.turn > pending.current.turn) {
        pending.current = null
        setUnsentReply(null)
      }
      setSession(next)
      restoredId.current = next.id
      updatePracticeURL(next.scenarioId, next.id)
      onSuccess?.(next)
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof PracticeError && cause.status === 404) {
        setSession(null)
        restoredId.current = null
        pending.current = null
        setUnsentReply(null)
        updatePracticeURL()
        setError('ไม่พบการฝึกเดิม เริ่มใหม่ได้เลย')
      } else {
        setError(failure)
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null
        setBusy(false)
      }
    }
  }, [scenarioId])

  const restore = useCallback((id: string) => {
    void run((signal) => readSession(id, signal), 'โหลดบทสนทนาไม่สำเร็จ ลองอีกครั้ง')
  }, [run])

  useEffect(() => {
    if (restoredId.current) restore(restoredId.current)
    return () => {
      operation.current?.abort()
      operation.current = null
    }
  }, [restore])

  function start() {
    void run((signal) => startSession(scenarioId, signal), 'เริ่มฝึกไม่สำเร็จ ลองอีกครั้ง', playLatest)
  }

  function finish(id: string) {
    voice.stop()
    void run((signal) => finishSession(id, signal), 'โหลดผลการฝึกไม่สำเร็จ ลองดูผลอีกครั้ง')
  }

  function playLatest(next: Session) {
    const message = next.messages.at(-1)
    if (voice.enabled && message?.role === 'npc') voice.play(message.text)
  }

  const requestingMicrophone = speech.status === 'requesting'
  const recording = speech.status === 'listening' || speech.status === 'stopping'
  const microphoneBusy = speech.status !== 'idle'

  function handleMicrophone() {
    if (recording) {
      speech.stop()
      return
    }
    setUnsentReply(null)
    setError('')
    voice.stop()
    void speech.start()
  }

  function send(text: string) {
    if (session?.status !== 'active' || operation.current || !text || isTooLong(text)) return
    const { id, turn } = session
    let input = pending.current
    if (!input || input.turn !== turn || input.text !== text) {
      input = { requestId: crypto.getRandomValues(new Uint32Array(4)).join('-'), turn, text }
      pending.current = input
    }
    const submission = input
    void run(async (signal) => {
      try {
        return await sendMessage(id, submission, signal)
      } catch (cause) {
        if (cause instanceof PracticeError && cause.status === 409) {
          const latest = await readSession(id, signal)
          if (latest.turn > turn) return latest
        }
        throw cause
      }
    }, 'ส่งคำตอบไม่สำเร็จ ลองส่งอีกครั้ง', playLatest)
  }

  if (!session) {
    const id = restoredId.current
    return (
      <div>
        {busy && <p role="status">กำลังโหลดบทสนทนา…</p>}
        {error && <p role="alert">{error}</p>}
        {!busy && (
          <button className="button primary" onClick={id ? () => restore(id) : start}>
            {id ? 'โหลดอีกครั้ง' : 'เริ่มคุย'}
          </button>
        )}
      </div>
    )
  }

  if (session.results) {
    return <PracticeResults session={session} retry={start} exit={exit} busy={busy} error={error} />
  }

  const active = session.status === 'active'
  const latestReply = session.messages.at(-1)?.text ?? ''
  const hasAudio = voice.hasClip(latestReply)
  const tooLong = unsentReply !== null && isTooLong(unsentReply)

  let callStatus = 'พร้อมคุย'
  if (!active) callStatus = busy ? 'กำลังเตรียมผลการฝึก…' : 'จบบทสนทนาแล้ว'
  else if (busy) callStatus = 'กำลังตอบ…'
  else if (requestingMicrophone) callStatus = 'กำลังขอใช้ไมโครโฟน…'
  else if (speech.status === 'stopping') callStatus = 'กำลังแปลงเสียง…'
  else if (recording) callStatus = 'กำลังฟัง…'
  else if (voice.speaking) callStatus = 'กำลังพูด…'

  return (
    <div className="practice">
      <section className="voice-call" aria-labelledby="call-character">
        <p className="call-round">รอบที่ {Math.min(session.turn + 1, session.turnLimit)} / {session.turnLimit}</p>
        <div className="call-person">
          {scenario.character && (
            <img
              className={voice.speaking ? 'portrait speaking' : 'portrait'}
              src={`/avatars/${scenarioId}.jpg`}
              alt=""
              width="112"
              height="112"
            />
          )}
          <h3 id="call-character">{character}</h3>
          <p className="call-status" role="status">{callStatus}</p>
        </div>

        <p className="call-caption">{latestReply}</p>

        {active && speech.supported && (
          <button
            className="call-microphone"
            type="button"
            onClick={handleMicrophone}
            disabled={busy || requestingMicrophone || speech.status === 'stopping'}
            data-recording={recording}
          >
            <span className="call-mic-disc" aria-hidden="true">
              <span className={recording ? 'call-stop-icon' : 'call-mic-icon'} />
            </span>
            <span>{recording ? 'หยุดและส่ง' : 'กดเพื่อพูด'}</span>
          </button>
        )}

        {hasAudio && (
          <div className="call-playback">
            <button className="call-speaker" aria-label="เสียงคู่สนทนา" aria-pressed={voice.enabled} disabled={microphoneBusy || busy}
              onClick={() => voice.toggle(latestReply)}>
              {voice.enabled ? 'เปิดเสียงอยู่' : 'ปิดเสียงอยู่'}
            </button>
            {voice.enabled && (
              <>
                <button type="button" onClick={() => voice.play(latestReply)} disabled={busy || microphoneBusy || voice.speaking}>
                  ฟังอีกครั้ง
                </button>
                <label>
                  ความเร็วเสียง
                  <select value={voice.rate} disabled={busy || microphoneBusy} onChange={(event) => voice.setRate(Number(event.target.value))}>
                    <option value={0.8}>ช้า</option>
                    <option value={1}>ปกติ</option>
                    <option value={1.2}>เร็ว</option>
                  </select>
                </label>
              </>
            )}
          </div>
        )}
        {!hasAudio && <p className="call-note">ข้อความนี้มีให้อ่านบนหน้าจอ</p>}
        {voice.failed && <p className="call-note" role="status">เล่นเสียงไม่ได้ ลองกดฟังอีกครั้งหรืออ่านคำตอบบนหน้าจอ</p>}
        {active && !speech.supported && <p className="call-note" role="alert">เบราว์เซอร์นี้แปลงเสียงเป็นข้อความไม่ได้ ลองเปิดใน Chrome หรือ Safari</p>}
        {active && speech.error && <p className="call-note" role="alert">{speech.error}</p>}
        {error && <p className="call-note" role="alert">{error}</p>}
        {tooLong && <p className="call-note" role="alert">คำตอบยาวเกินไป ลองพูดให้สั้นลงแล้วส่งใหม่</p>}
        {active && unsentReply !== null && !tooLong && !busy && (
          <div className="call-retry">
            <p>คำพูดที่ยังไม่ได้ส่ง</p>
            <p>{unsentReply}</p>
            <button className="call-speaker" onClick={() => send(unsentReply)} disabled={microphoneBusy}>ลองส่งอีกครั้ง</button>
          </div>
        )}
        {!active && (
          <button className="call-results" onClick={() => finish(session.id)} disabled={busy}>ดูผลการฝึก</button>
        )}
      </section>

      <details className="call-details">
        <summary>บทสนทนา</summary>
        <ol aria-label="บทสนทนา">
          {session.messages.map((message, index) => (
            <li className={`dialogue ${message.role}`} key={index}>
              <p className="dialogue-label">{message.role === 'npc' ? character : 'คุณ'}</p>
              <p>{message.text}</p>
            </li>
          ))}
        </ol>
      </details>
      <details className="call-details">
        <summary>เป้าหมายการฝึก</summary>
        <ul>
          {session.objectives.map((objective) => (
            <li key={objective.id}>
              {objective.description}{session.achieved.includes(objective.id) && ' (ทำได้แล้ว)'}
            </li>
          ))}
        </ul>
        <p>ความไว้วางใจ {session.trust} / 100</p>
      </details>
    </div>
  )
}
