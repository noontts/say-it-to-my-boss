import { useEffect, useRef, useState } from 'react'
import { useScenarioRequest } from './hooks/use-scenario-request'
import { updatePracticeURL } from './services/practice'
import { Practice } from './pages/practice'
import type { ScenarioCatalog } from './types/scenario'

export function App() {
  const [scenarioId, setScenarioId] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    return query.has('session') ? query.get('scenario') : null
  })
  const heading = useRef<HTMLHeadingElement>(null)
  const catalog = useScenarioRequest<ScenarioCatalog>('/api/v1/scenarios')
  const scenario = catalog.state.status === 'ready'
    ? catalog.state.data.scenarios.find((item) => item.id === scenarioId)
    : undefined

  useEffect(() => {
    heading.current?.focus()
  }, [scenario?.id])

  function showPicker() {
    updatePracticeURL()
    setScenarioId(null)
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>ขอคุยกับหัวหน้า</h1>
      </header>

      {!scenario ? (
        <section aria-labelledby="page-title">
          <h2 id="page-title" tabIndex={-1} ref={heading}>เลือกสถานการณ์</h2>
          {catalog.state.status === 'loading' && <p role="status">กำลังโหลดสถานการณ์…</p>}
          {catalog.state.status === 'error' && (
            <div className="panel">
              <p role="alert">โหลดสถานการณ์ไม่สำเร็จ</p>
              <button className="button primary" onClick={catalog.retry}>ลองใหม่</button>
            </div>
          )}
          {catalog.state.status === 'ready' && (
            catalog.state.data.scenarios.length === 0 ? (
              <p>ยังไม่มีสถานการณ์ให้เลือก</p>
            ) : (
              <ul className="scenario-list">
                {catalog.state.data.scenarios.map((item) => (
                  <li key={item.id}>
                    <button
                      className="scenario-card"
                      onClick={() => {
                        updatePracticeURL()
                        setScenarioId(item.id)
                      }}
                    >
                      <span className="profession">{item.profession}</span>
                      <span className="scenario-title">{item.title}</span>
                      <span className={item.playable ? 'availability available' : 'availability'}>
                        {item.playable ? 'พร้อมฝึก' : 'เร็ว ๆ นี้'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </section>
      ) : (
        <section aria-labelledby="page-title">
          <button className="button back" onClick={showPicker}>← เลือกสถานการณ์</button>
          <p className="profession">{scenario.profession}</p>
          <h2 id="page-title" tabIndex={-1} ref={heading}>{scenario.title}</h2>
          <div className="panel">
            <p>{scenario.description}</p>
            {scenario.playable ? (
              <Practice key={scenario.id} scenario={scenario} exit={showPicker} />
            ) : (
              <p className="availability">เร็ว ๆ นี้</p>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
