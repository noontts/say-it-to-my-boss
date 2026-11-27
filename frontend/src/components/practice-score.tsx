import type { Session } from '../services/practice'

export function PracticeScore({ session, closingReply }: { session: Session; closingReply?: string }) {
  const achieved = session.objectives.filter((objective) => session.achieved.includes(objective.id)).length
  const score = session.objectives.length ? Math.floor(100 * achieved / session.objectives.length) : 0

  return (
    <section className="office-score" aria-labelledby="score-heading">
      <div>
        <h2 id="score-heading">คะแนนการฝึก</h2>
        <p aria-live="polite">{score} / 100</p>
      </div>
      {closingReply && <p>{closingReply}</p>}
    </section>
  )
}
