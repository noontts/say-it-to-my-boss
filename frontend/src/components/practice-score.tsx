import { useEffect, useRef, type ReactNode } from 'react'
import type { Session } from '../services/practice'

export function PracticeScore({ session, nextRound, children }: {
  session: Session
  nextRound: () => void
  children?: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  const achieved = session.objectives.filter((objective) => session.achieved.includes(objective.id)).length
  const score = session.objectives.length ? Math.floor(100 * achieved / session.objectives.length) : 0

  return (
    <section className="game-stage" aria-labelledby="score-heading">
      <h1 id="score-heading" tabIndex={-1} ref={heading}>คะแนนการฝึก</h1>
      <p className="game-score">{score}<span> / 100</span></p>
      <button className="game-button" onClick={nextRound}>เล่นต่อ</button>
      {children}
    </section>
  )
}
