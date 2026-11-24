import { useEffect, useRef, useState } from 'react'
import { playIncomingRing } from './components/incoming-ring'
import { useScenarioRequest } from './hooks/use-scenario-request'
import { updatePracticeURL } from './services/practice'
import { Practice } from './pages/practice'
import type { ScenarioCatalog } from './types/scenario'

export function App() {
  const [round, setRound] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    return { scenarioId: query.has('session') ? query.get('scenario') : null, number: 0 }
  })
  const stopRing = useRef<(() => void) | undefined>(undefined)
  const catalog = useScenarioRequest<ScenarioCatalog>('/api/v1/scenarios')
  const playable = catalog.state.status === 'ready'
    ? catalog.state.data.scenarios.filter((item) => item.playable)
    : []
  const scenario = playable.find((item) => item.id === round.scenarioId)

  useEffect(() => () => stopRing.current?.(), [])

  function stopIncomingRing() {
    stopRing.current?.()
    stopRing.current = undefined
  }

  function drawScenario() {
    const different = playable.filter((item) => item.id !== round.scenarioId)
    const pool = different.length ? different : playable
    if (!pool.length) return
    const next = pool[Math.floor(Math.random() * pool.length)]

    updatePracticeURL()
    stopIncomingRing()
    stopRing.current = playIncomingRing()
    setRound({ scenarioId: next.id, number: round.number + 1 })
  }

  return (
    <main className="game">
      {scenario ? (
        <Practice key={round.number} scenario={scenario} nextRound={drawScenario} stopIncomingRing={stopIncomingRing} />
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
              <button className="game-button" onClick={drawScenario}>เริ่มเกม</button>
            ) : (
              <p>ยังไม่มีสถานการณ์ให้เล่น</p>
            )
          )}
        </section>
      )}
    </main>
  )
}
