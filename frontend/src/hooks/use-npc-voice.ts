import { useCallback, useEffect, useRef, useState } from 'react'
import voices from '../data/npc-voices.json'

const clipsByScenario = new Map(
  Object.entries(voices).map(([scenario, clips]) => [scenario, new Map(Object.entries(clips))]),
)

const normalize = (text: string) => text.replace(/[\s\p{P}]/gu, '')

function findThaiVoice() {
  const voices = window.speechSynthesis?.getVoices().filter((voice) => /^th(?:[-_]|$)/i.test(voice.lang))
  return voices?.find((voice) => voice.localService) ?? voices?.[0]
}

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
  const [hasThaiVoice, setHasThaiVoice] = useState(() => Boolean(findThaiVoice()))
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
    previous?.done?.(finished)
  }, [])

  useEffect(() => stop, [stop])
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const update = () => setHasThaiVoice(Boolean(findThaiVoice()))
    synth.addEventListener('voiceschanged', update)
    update()
    return () => synth.removeEventListener('voiceschanged', update)
  }, [])

  function complete(playback: Playback, failed = false, isSpeech = true) {
    if (current.current !== playback) return
    stop(true)
    if (failed && isSpeech) setFailed(true)
  }

  function playAudio(source: string, text: string | null, done?: (finished: boolean) => void) {
    stop()
    if (text !== null) setFailed(false)

    const player = new Audio(source)
    const playback = { cancel: () => player.pause(), text: text === null ? '' : normalize(text), done }
    current.current = playback
    player.playbackRate = text === null ? 1 : rate
    setSpeaking(text !== null)
    player.onended = () => complete(playback)
    const handleError = () => complete(playback, true, text !== null)
    player.onerror = handleError
    void player.play().catch(handleError)
  }

  function play(text: string, done?: (finished: boolean) => void, live = false) {
    const source = clips?.get(text)
    if (source) {
      playAudio(source, text, done)
      return
    }

    stop()
    setFailed(false)
    const voice = live && findThaiVoice()
    if (!voice || typeof SpeechSynthesisUtterance === 'undefined') {
      done?.(true)
      return
    }

    const synth = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice.lang
    utterance.voice = voice
    utterance.rate = rate
    const playback = {
      text: normalize(text),
      cancel: () => {
        window.clearTimeout(startDeadline)
        synth.cancel()
      },
      done,
    }
    const startDeadline = window.setTimeout(() => complete(playback, true), 5000)
    current.current = playback
    setSpeaking(true)
    utterance.onstart = () => window.clearTimeout(startDeadline)
    utterance.onend = () => complete(playback)
    utterance.onerror = () => complete(playback, true)
    try {
      synth.speak(utterance)
    } catch {
      complete(playback, true)
    }
  }

  function playEndTone() {
    playAudio('/sounds/call-ended.mp3', null)
  }

  function toggle(text: string, live = false) {
    setEnabled(!enabled)
    if (enabled) {
      stop()
      setFailed(false)
    } else {
      play(text, undefined, live)
    }
  }

  function isEcho(text: string) {
    const fragment = normalize(text)
    const recent = recentLine.current
    return Boolean(fragment && (current.current?.text.includes(fragment) ||
      (performance.now() < recent.until && recent.text.includes(fragment))))
  }

  const canPlay = (text: string, live: boolean) => Boolean(clips?.has(text) ||
    (live && hasThaiVoice && typeof SpeechSynthesisUtterance !== 'undefined'))

  return { canPlay, enabled, rate, setRate, speaking, failed, play, playEndTone, stop, toggle, isEcho }
}
