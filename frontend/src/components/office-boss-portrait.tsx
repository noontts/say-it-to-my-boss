import type { Session } from '../services/practice'

const moodLabels = {
  frustrated: 'หัวหน้ากำลังหงุดหงิด',
  concerned: 'หัวหน้ากำลังกังวล',
  reassured: 'หัวหน้าเริ่มสบายใจ',
}

export function OfficeBossPortrait({ mood, speaking }: { mood: Session['mood']; speaking: boolean }) {
  return <span className="office-boss-portrait" role="img" aria-label={moodLabels[mood]}
    data-mood={mood} data-speaking={speaking} />
}
