import { useEffect, useRef, useState } from 'react'
import { officeRingDelay } from './components/office'
import { useScenarioRequest } from './hooks/use-scenario-request'
import { updatePracticeURL } from './services/practice'
import { Practice } from './pages/practice'
import type { ScenarioCatalog } from './types/scenario'

export function App() {
  const [round, setRound] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    return {
      scenarioId: query.has('session') ? query.get('scenario') : null,
      number: 0,
      ringAt: null as number | null,
    }
  })
  const officeAudio = useRef<AudioContext | null>(null)
  const catalog = useScenarioRequest<ScenarioCatalog>('/api/v1/scenarios')
  const playable = catalog.state.status === 'ready'
    ? catalog.state.data.scenarios.filter((item) => item.playable)
    : []
  const scenario = playable.find((item) => item.id === round.scenarioId)

  useEffect(() => () => {
    const context = officeAudio.current
    officeAudio.current = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }, [])

  function enterOffice() {
    const different = playable.filter((item) => item.id !== round.scenarioId)
    const pool = different.length ? different : playable
    if (!pool.length) return
    const next = pool[Math.floor(Math.random() * pool.length)]

    updatePracticeURL()
    try {
      officeAudio.current ??= new AudioContext()
      void officeAudio.current.resume().catch(() => {})
    } catch { /* The visual phone alert works without audio. */ }
    setRound({ scenarioId: next.id, number: round.number + 1, ringAt: performance.now() + officeRingDelay })
  }

  return (
    <main className="game">
      {scenario ? (
        <Practice key={round.number} scenario={scenario} nextRound={enterOffice}
          officeRingAt={round.ringAt} officeAudio={officeAudio.current} />
      ) : (
        <section className="game-stage game-home" aria-labelledby="game-title">
          <span className="game-phone" aria-hidden="true">☎</span>
          <h1 id="game-title">ขอคุยกับหัวหน้า</h1>
          {catalog.state.status === 'loading' && <p role="status">กำลังโหลดสถานการณ์…</p>}
          {catalog.state.status === 'error' && (
            <>
              <p role="alert">โหลดสถานการณ์ไม่สำเร็จ</p>
              <button className="game-button" onClick={catalog.retry}>ลองใหม่</button>
            </>
          )}
          {catalog.state.status === 'ready' && (
            playable.length ? (
              <button className="game-button" onClick={enterOffice}>เริ่มเกม</button>
            ) : (
              <p>ยังไม่มีสถานการณ์ให้เล่น</p>
            )
          )}
        </section>
      )}
    </main>
  )
}
