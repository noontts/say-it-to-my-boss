import { useId, useState } from 'react'
import type { Session } from '../services/practice'

export function CallHint({ objectives }: { objectives: Session['objectives'] }) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="call-hint">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        Hint
      </button>
      <div id={contentId} hidden={!expanded}>
        <p>แนวทางการคุย</p>
        <ul>
          {objectives.map((objective) => <li key={objective.id}>{objective.description}</li>)}
        </ul>
      </div>
    </div>
  )
}
