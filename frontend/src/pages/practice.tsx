import { Fragment, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useSpeechToText } from '../hooks/use-speech-to-text'
import { useNpcVoice } from '../hooks/use-npc-voice'
import { PracticeResults } from '../components/practice-results'
import type { ScenarioSummary } from '../types/scenario'
import {
  PracticeError, finishSession, hangUpSession, npcVoiceURL, readSession, sendMessage, startSession, updatePracticeURL,
  type Session, type TurnSubmission,
} from '../services/practice'

const maxMessageLength = 1000
const isTooLong = (text: string) => Array.from(text).length > maxMessageLength
const bossInterjection = 'ขอเข้าประเด็นเลยครับ'
const bossTakeover = 'เดี๋ยวครับ ฟังผมก่อน ขอคำตอบสั้น ๆ ให้ตรงคำถามครับ'
const bossReminder = 'ทำไมยังไม่ตอบครับ?'
const answerWait = 8_000

type BossLine = { text: string; interruption: boolean }

export function Practice({ scenario, exit }: { scenario: ScenarioSummary; exit: () => void }) {
  const { id: scenarioId, character = 'คู่สนทนา' } = scenario
  const restoredId = useRef(new URLSearchParams(window.location.search).get('session'))
  const operation = useRef<AbortController | null>(null)
  const pending = useRef<TurnSubmission | null>(null)
  const transcriptList = useRef<HTMLOListElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [busy, setBusy] = useState(Boolean(restoredId.current))
  const [error, setError] = useState('')
  const [unsentReply, setUnsentReply] = useState<string | null>(null)
  const [bossLines, setBossLines] = useState<Record<number, BossLine[]>>({})
  const [takingFloor, setTakingFloor] = useState(false)
  const [playingGoodbye, setPlayingGoodbye] = useState(false)
  const [manualHangUp, setManualHangUp] = useState(false)
  const floorTaken = useRef(false)
  const speechStartedAt = useRef<number | null>(null)
  const evaluatedTurn = useRef(-1)
  const endToneSession = useRef<string | null>(null)
  const voice = useNpcVoice(scenarioId)

  const savingHangUp = session?.status === 'active' && manualHangUp
  const active = session?.status === 'active' && !manualHangUp
  const speech = useSpeechToText({
    accept: (text) => active && !operation.current && !pending.current &&
      unsentReply === null && !floorTaken.current && !voice.isEcho(text),
    onInterim: (text) => {
      if (scenarioId !== 'angry-boss' || !session || !voice.enabled || evaluatedTurn.current === session.turn) return true
      const now = performance.now()
      speechStartedAt.current ??= now
      if (now - speechStartedAt.current < 1250 || Array.from(text).length < 30) return true

      evaluatedTurn.current = session.turn
      const chance = session.trust < 40 ? 0.65 : session.trust >= 70 ? 0.15 : 0.4
      const decision = Math.random()
      if (decision >= chance) return true

      const takeover = decision < chance / 3
      const line = takeover ? bossTakeover : bossInterjection
      addBossLine(session.turn, { text: line, interruption: true })
      if (takeover) {
        floorTaken.current = true
        setTakingFloor(true)
      }
      voice.play(line, takeover ? () => {
        speech.discard()
        floorTaken.current = false
        setTakingFloor(false)
      } : undefined)
      return !takeover
    },
    onComplete: (transcript) => {
      speechStartedAt.current = null
      if (!active || operation.current || pending.current || floorTaken.current || unsentReply !== null) return
      setError('')
      setUnsentReply(transcript)
      send(transcript)
    },
  })
  const stopMicrophone = speech.stop

  useEffect(() => {
    if (!active) stopMicrophone()
  }, [active, stopMicrophone])

  const draft = unsentReply ?? speech.preview
  const currentBossLines = session ? bossLines[session.turn] : undefined
  const alreadyReminded = Boolean(currentBossLines?.some((line) => line.text === bossReminder))
  const waitingForAnswer = scenarioId === 'angry-boss' && active && speech.status !== 'requesting' &&
    !busy && !takingFloor && !voice.speaking && !draft

  function addBossLine(turn: number, line: BossLine) {
    setBossLines((previous) => ({ ...previous, [turn]: [...(previous[turn] ?? []), line] }))
  }

  function signalCallEnd(id: string) {
    if (endToneSession.current === id) return
    endToneSession.current = id
    if (voice.enabled) voice.playEndTone()
  }

  const playGoodbye = useEffectEvent((next: Session) => {
    const goodbye = next.messages.at(-1)
    if (!voice.enabled || goodbye?.role !== 'npc') {
      signalCallEnd(next.id)
      return
    }
    setPlayingGoodbye(true)
    voice.play(goodbye.text, (finished) => {
      setPlayingGoodbye(false)
      if (finished) signalCallEnd(next.id)
    })
  })

  const handleSilence = useEffectEvent(() => {
    if (!session || !waitingForAnswer || operation.current) return
    const { id, turn } = session
    if (!alreadyReminded) {
      addBossLine(turn, { text: bossReminder, interruption: false })
      if (voice.enabled) voice.play(bossReminder)
      return
    }

    void run(async (signal) => {
      try {
        return await hangUpSession(id, { turn }, signal)
      } catch (cause) {
        if (cause instanceof PracticeError && cause.status === 409) {
          const latest = await readSession(id, signal)
          if (latest.turn !== turn || latest.status !== 'active') return latest
        }
        throw cause
      }
    }, 'บันทึกการวางสายไม่สำเร็จ', (next) => {
      if (next.endReason === 'silence') playGoodbye(next)
      else {
        if (next.status === 'active') speech.discard()
        playLatest(next)
      }
    })
  })

  useEffect(() => {
    if (!waitingForAnswer) return
    const timer = window.setTimeout(() => handleSilence(), answerWait)
    return () => window.clearTimeout(timer)
  }, [session?.id, session?.turn, waitingForAnswer, alreadyReminded])

  const messages = session?.messages
  useEffect(() => {
    const list = transcriptList.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, draft, bossLines])

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
    void run((signal) => startSession(scenarioId, signal), 'เริ่มฝึกไม่สำเร็จ ลองอีกครั้ง', (next) => {
      setBossLines({})
      evaluatedTurn.current = -1
      speechStartedAt.current = null
      void speech.start()
      playLatest(next)
    })
  }

  function finish(id: string) {
    if (voice.speaking) {
      voice.stop()
      signalCallEnd(id)
    }
    void run((signal) => finishSession(id, signal), 'โหลดผลการฝึกไม่สำเร็จ ลองดูผลอีกครั้ง')
  }

  function hangUp(id: string) {
    setManualHangUp(true)
    operation.current?.abort()
    operation.current = null
    pending.current = null
    setUnsentReply(null)
    speech.stop()
    voice.stop()
    signalCallEnd(id)
    void run((signal) => hangUpSession(id, { reason: 'player' }, signal),
      'บันทึกการวางสายไม่สำเร็จ', () => setManualHangUp(false))
  }

  function playLatest(next: Session) {
    const message = next.messages.at(-1)
    if (!voice.enabled || message?.role !== 'npc') return
    const closing = next.status !== 'active'
    voice.play(message.text, closing ? (finished) => {
      if (finished) signalCallEnd(next.id)
    } : undefined, npcVoiceURL(next, next.messages.length - 1))
  }

  const requestingMicrophone = speech.status === 'requesting'
  const listening = speech.status === 'listening'

  function handleMicrophone() {
    speechStartedAt.current = null
    if (listening) {
      speech.stop()
      return
    }
    void speech.start()
  }

  function discardReply() {
    pending.current = null
    setUnsentReply(null)
    setError('')
    speech.discard()
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
    }, 'ส่งคำตอบไม่สำเร็จ ลองส่งอีกครั้ง', (next) => {
      if (next.status === 'active') speech.discard()
      playLatest(next)
    })
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

  const endedAfterSilence = session.endReason === 'silence'
  const latestBossLine = endedAfterSilence ? undefined : currentBossLines?.at(-1)
  const latestReply = latestBossLine?.text ?? session.messages.at(-1)?.text ?? ''
  const voiceURL = latestBossLine ? undefined : npcVoiceURL(session, session.messages.length - 1)
  const hasAudio = voice.canPlay(latestReply, voiceURL)
  const tooLong = unsentReply !== null && isTooLong(unsentReply)

  let callStatus = 'ไมค์ปิดอยู่'
  if (savingHangUp) callStatus = busy ? 'กำลังวางสาย…' : 'วางสายแล้ว'
  else if (playingGoodbye) callStatus = 'หัวหน้ากำลังวางสาย…'
  else if (!active) {
    if (busy) callStatus = 'กำลังเตรียมผลการฝึก…'
    else if (endedAfterSilence) callStatus = 'หัวหน้าวางสายแล้ว'
    else if (session.endReason === 'player') callStatus = 'คุณวางสายแล้ว'
    else callStatus = 'จบบทสนทนาแล้ว'
  }
  else if (takingFloor) callStatus = 'หัวหน้าพูดแทรกอยู่ รอให้พูดจบแล้วตอบอีกครั้ง'
  else if (busy) callStatus = 'กำลังตอบ…'
  else if (requestingMicrophone) callStatus = 'กำลังขอใช้ไมโครโฟน…'
  else if (voice.preparing) callStatus = 'กำลังเตรียมเสียง…'
  else if (voice.speaking) callStatus = listening ? 'กำลังพูด · ไมค์เปิดอยู่' : 'กำลังพูด…'
  else if (listening) callStatus = 'กำลังฟัง…'

  return (
    <div className="practice">
      <section className="voice-call" aria-labelledby="call-character">
        <p className="call-round">รอบที่ {Math.min(session.turn + 1, session.turnLimit)} / {session.turnLimit}</p>
        <div className="call-person">
          {scenario.character && (
            <img
              className={voice.speaking && !voice.preparing ? 'portrait speaking' : 'portrait'}
              src={`/avatars/${scenarioId}.jpg`}
              alt=""
              width="112"
              height="112"
            />
          )}
          <h3 id="call-character">{character}</h3>
          <p className="call-status" role="status">{callStatus}</p>
        </div>

        <ol ref={transcriptList} className="call-transcript" role="list" aria-label="บทสนทนา" tabIndex={0}>
          {session.messages.map((message, index) => {
            let lines = message.role === 'player' ? bossLines[(index - 1) / 2] : undefined
            if (endedAfterSilence && index === session.messages.length - 2) {
              lines = currentBossLines?.filter((line) => line.interruption)
            }
            return (
              <Fragment key={index}>
                {lines?.map((line) => <BossBubble key={line.text} character={character} line={line} />)}
                <li className={`call-bubble ${message.role}`}>
                  <p className="call-bubble-label">{message.role === 'npc' ? character : 'คุณ'}</p>
                  <p>{message.text}</p>
                </li>
              </Fragment>
            )
          })}
          {!endedAfterSilence && currentBossLines?.map((line) => <BossBubble key={line.text} character={character} line={line} />)}
          {draft && (
            <li className="call-bubble player">
              <p className="call-bubble-label">คุณ</p>
              <p>{draft}</p>
              {unsentReply !== null && (
                <p className="call-bubble-label">{busy ? 'กำลังส่ง…' : 'คำพูดที่ยังไม่ได้ส่ง'}</p>
              )}
            </li>
          )}
        </ol>

        {(active || savingHangUp) && (
          <div className="call-controls">
            {active && speech.supported && (
              <button
                className="call-microphone"
                type="button"
                onClick={handleMicrophone}
                disabled={requestingMicrophone}
                data-recording={listening}
              >
                <span className="call-mic-disc" aria-hidden="true">
                  <span className={listening ? 'call-mic-icon' : 'call-mic-icon muted'} />
                </span>
                <span>{listening ? 'ปิดไมค์' : 'เปิดไมค์'}</span>
              </button>
            )}
            <button className="call-hang-up" type="button" onClick={() => hangUp(session.id)} disabled={savingHangUp && busy}>
              {savingHangUp ? (busy ? 'กำลังวางสาย…' : 'บันทึกการวางสายอีกครั้ง') : 'วางสาย'}
            </button>
          </div>
        )}

        {hasAudio && (active || voice.speaking) && (
          <div className="call-playback">
            <button className="call-speaker" aria-label="เสียงคู่สนทนา" aria-pressed={voice.enabled}
              onClick={() => voice.toggle(latestReply, voiceURL)}>
              {voice.enabled ? 'เปิดเสียงอยู่' : 'ปิดเสียงอยู่'}
            </button>
            {voice.enabled && (
              <label>
                ความเร็วเสียง
                <select value={voice.rate} onChange={(event) => voice.setRate(Number(event.target.value))}>
                  <option value={0.8}>ช้า</option>
                  <option value={1}>ปกติ</option>
                  <option value={1.2}>เร็ว</option>
                </select>
              </label>
            )}
          </div>
        )}
        {!hasAudio && <p className="call-note">ข้อความนี้มีให้อ่านบนหน้าจอ</p>}
        {voice.failed && <p className="call-note" role="status">เล่นเสียงไม่ได้ อ่านคำตอบได้ในบทสนทนา</p>}
        {active && !speech.supported && <p className="call-note" role="alert">เบราว์เซอร์นี้แปลงเสียงเป็นข้อความไม่ได้ ลองเปิดใน Chrome หรือ Safari</p>}
        {active && speech.error && <p className="call-note" role="alert">{speech.error}</p>}
        {error && <p className="call-note" role="alert">{error}</p>}
        {tooLong && <p className="call-note" role="alert">คำตอบยาวเกินไป ลองพูดให้สั้นลงแล้วส่งใหม่</p>}
        {active && unsentReply !== null && !busy && (
          <div className="call-playback">
            {!tooLong && <button className="call-speaker" onClick={() => send(unsentReply)}>ลองส่งอีกครั้ง</button>}
            <button className="call-speaker" onClick={discardReply}>พูดใหม่</button>
          </div>
        )}
        {!active && !savingHangUp && (
          <button className="call-results" onClick={() => finish(session.id)} disabled={busy || playingGoodbye}>ดูผลการฝึก</button>
        )}
      </section>

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

function BossBubble({ character, line }: { character: string; line: BossLine }) {
  return (
    <li className="call-bubble npc">
      <p className="call-bubble-label">{character}{line.interruption && ' · พูดแทรก'}</p>
      <p>{line.text}</p>
    </li>
  )
}
