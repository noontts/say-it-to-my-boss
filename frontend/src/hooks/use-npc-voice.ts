import { useCallback, useEffect, useRef, useState } from 'react'
import voices from '../data/npc-voices.json'

const clipsByScenario = new Map(
  Object.entries(voices).map(([scenario, clips]) => [scenario, new Map(Object.entries(clips))]),
)

const normalize = (text: string) => text.replace(/[\s\p{P}]/gu, '')

type Playback = {
  cancel: () => void
  text: string
  done?: (finished: boolean) => void
}

export function useNpcVoice(scenarioId: string) {
  const clips = clipsByScenario.get(scenarioId)
  const [enabled, setEnabled] = useState(true)
  const [rate, setRate] = useState(1)
  const [speaking, setSpeaking] = useState(false)
  const [failed, setFailed] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const current = useRef<Playback | null>(null)
  const recentLine = useRef({ text: '', until: 0 })

  const stop = useCallback((finished = false) => {
    const previous = current.current
    current.current = null
    if (previous) {
      previous.cancel()
      if (previous.text) recentLine.current = { text: previous.text, until: performance.now() + 600 }
    }
    setSpeaking(false)
    setPreparing(false)
    previous?.done?.(finished)
  }, [])

  useEffect(() => stop, [stop])

  function complete(playback: Playback, failed = false, isSpeech = true) {
    if (current.current !== playback) return
    stop(true)
    if (failed && isSpeech) setFailed(true)
  }

  function playAudio(source: string, text: string | null, done?: (finished: boolean) => void, live = false) {
    stop()
    if (text !== null) setFailed(false)

    const player = new Audio(source)
    const playback = {
      cancel: () => {
        player.pause()
        player.removeAttribute('src')
        player.load()
      },
      text: text === null ? '' : normalize(text),
      done,
    }
    current.current = playback
    player.playbackRate = text === null ? 1 : rate
    setSpeaking(text !== null)
    setPreparing(live)
    player.onplaying = () => {
      if (current.current === playback) setPreparing(false)
    }
    player.onended = () => complete(playback)
    const handleError = () => complete(playback, true, text !== null)
    player.onerror = handleError
    void player.play().catch(handleError)
  }

  function play(text: string, done?: (finished: boolean) => void, voiceURL?: string) {
    const clip = clips?.get(text)
    const source = clip ?? voiceURL
    if (source) {
      playAudio(source, text, done, !clip)
      return
    }

    stop()
    setFailed(false)
    done?.(true)
  }

  function playEndTone() {
    playAudio('/sounds/call-ended.mp3', null)
  }

  function toggle(text: string, voiceURL?: string) {
    setEnabled(!enabled)
    if (enabled) {
      stop()
      setFailed(false)
    } else {
      play(text, undefined, voiceURL)
    }
  }

  function isEcho(text: string) {
    const fragment = normalize(text)
    const recent = recentLine.current
    return Boolean(fragment && (current.current?.text.includes(fragment) ||
      (performance.now() < recent.until && recent.text.includes(fragment))))
  }

  const canPlay = (text: string, voiceURL?: string) => Boolean(clips?.has(text) || voiceURL)

  return { canPlay, enabled, rate, setRate, speaking, preparing, failed, play, playEndTone, stop, toggle, isEcho }
}
