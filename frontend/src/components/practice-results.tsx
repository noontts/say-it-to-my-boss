import { useEffect, useRef } from 'react'
import type { Session } from '../services/practice'

const dimensions = [
  ['clarity', 'ความชัดเจน'],
  ['empathy', 'ความเข้าใจอีกฝ่าย'],
  ['professionalism', 'ความเป็นมืออาชีพ'],
  ['problemSolving', 'การแก้ปัญหา'],
] as const

export function PracticeResults({ session, retry, exit, busy, error }: {
  session: Session
  retry: () => void
  exit: () => void
  busy: boolean
  error: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const { results } = session
  if (!results) return null
  const outcome = session.status === 'succeeded' ? 'ทำเป้าหมายสำเร็จ' : 'ยังมีเป้าหมายให้ฝึกต่อ'

  return (
    <section className="practice-results" aria-labelledby="results-heading">
      <h3 id="results-heading" tabIndex={-1} ref={heading}>ผลการฝึก</h3>
      <p><strong>{outcome}</strong> · ความไว้วางใจสุดท้าย {session.trust} / 100</p>
      {session.mode === 'local' && <p className="voice-note">คะแนนโดยประมาณจากคำและวลีในคำตอบของคุณ</p>}
      <dl className="scores">
        {dimensions.map(([key, label]) => (
          <div key={key}><dt>{label}</dt><dd>{results.scores[key]} / 100</dd></div>
        ))}
        <div><dt>การทำตามเป้าหมาย</dt><dd>{results.objectiveCompletion} / 100</dd></div>
      </dl>
      <p>{results.summary}</p>
      {results.strengths.length > 0 && (
        <div>
          <h4>สิ่งที่ทำได้ดี</h4>
          <ul>{results.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}
      <div>
        <h4>สิ่งที่ลองปรับได้</h4>
        <ul>{results.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </div>
      {busy && <p role="status">กำลังเริ่มการฝึกใหม่…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button className="button primary" onClick={retry} disabled={busy}>ฝึกอีกครั้ง</button>
        <button className="button secondary" onClick={exit}>กลับไปเลือกสถานการณ์</button>
      </div>
    </section>
  )
}
