import { useCallback, useEffect, useRef, useState } from 'react'
import voices from '../data/npc-voices.json'

const clipsByScenario = new Map(
  Object.entries(voices).map(([scenario, clips]) => [scenario, new Map(Object.entries(clips))]),
)

export function useNpcVoice(scenarioId: string) {
  const clips = clipsByScenario.get(scenarioId)
  const [enabled, setEnabled] = useState(true)
  const [rate, setRate] = useState(1)
  const [speaking, setSpeaking] = useState(false)
  const [failed, setFailed] = useState(false)
  const current = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    const previous = current.current
    current.current = null
    previous?.pause()
    setSpeaking(false)
  }, [])

  useEffect(() => stop, [stop])

  function play(text: string) {
    stop()
    setFailed(false)
    const source = clips?.get(text)
    if (!source) return

    const player = new Audio(source)
    current.current = player
    player.playbackRate = rate
    player.onplaying = () => {
      if (current.current === player) setSpeaking(true)
    }
    player.onended = () => {
      if (current.current === player) stop()
    }
    const handleError = () => {
      if (current.current !== player) return
      stop()
      setFailed(true)
    }
    player.onerror = handleError
    void player.play().catch(handleError)
  }

  function toggle(text: string) {
    setEnabled(!enabled)
    if (enabled) {
      stop()
      setFailed(false)
    } else {
      play(text)
    }
  }

  return { hasClip: (text: string) => Boolean(clips?.has(text)), enabled, rate, setRate, speaking, failed, play, stop, toggle }
}
