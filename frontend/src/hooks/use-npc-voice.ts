import { useCallback, useEffect, useRef, useState } from 'react'
import { createPcmPlayback, pcmStreamType } from './pcm-playback'

const normalize = (text: string) => text.replace(/[\s\p{P}]/gu, '')
// A silent PCM sample lets the Start Call tap activate the same player used for fetched speech.
const silence = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA=='

type Playback = {
  cancel: () => void
  text: string
  done?: (finished: boolean) => void
}

export function useNpcVoice() {
  const [enabled, setEnabled] = useState(true)
  const [rate, setRate] = useState(1)
  const [speaking, setSpeaking] = useState(false)
  const [failure, setFailure] = useState<'blocked' | 'unavailable' | null>(null)
  const [preparing, setPreparing] = useState(false)
  const player = useRef<HTMLAudioElement | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const resuming = useRef<Promise<void> | null>(null)
  const cached = useRef<{ url: string; source: string } | null>(null)
  const current = useRef<Playback | null>(null)
  const recentLine = useRef({ text: '', until: 0 })

  function getPlayer() {
    return player.current ??= new Audio()
  }

  const clearCache = useCallback(() => {
    if (cached.current) URL.revokeObjectURL(cached.current.source)
    cached.current = null
  }, [])

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

  useEffect(() => () => {
    stop()
    player.current?.pause()
    const context = audioContext.current
    audioContext.current = null
    resuming.current = null
    if (context) void context.close().catch(() => {})
    clearCache()
  }, [stop, clearCache])

  function prime() {
    try {
      if (typeof AudioContext !== 'undefined') {
        const context = audioContext.current ??= new AudioContext()
        if (context.state !== 'running') resuming.current = context.resume().catch(() => {})
      }
    } catch {
      // The media element can still play a WAV if Web Audio is unavailable.
    }
    if (current.current) return
    const audio = getPlayer()
    audio.src = silence
    void audio.play().catch(() => {})
  }

  function playAudio(url: string, text: string | null, done?: (finished: boolean) => void, wavOnly = false) {
    stop()
    const speech = text !== null
    if (speech) setFailure(null)

    const audio = getPlayer()
    const controller = new AbortController()
    let timeout = window.setTimeout(() => complete('unavailable'), 10_000)
    const context = audioContext.current
    let pcm: ReturnType<typeof createPcmPlayback> | undefined
    const playback = {
      cancel: () => {
        window.clearTimeout(timeout)
        controller.abort()
        pcm?.cancel()
        context?.removeEventListener('statechange', checkContext)
        audio.onplaying = audio.onended = audio.onerror = null
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      },
      text: speech ? normalize(text) : '',
      done,
    }
    current.current = playback
    setSpeaking(speech)
    setPreparing(speech)

    function checkContext() {
      if (context?.state !== 'running') complete('blocked')
    }

    function complete(error: 'blocked' | 'unavailable' | null = null) {
      if (current.current !== playback) return
      stop(true)
      if (error && speech) {
        if (error === 'unavailable') clearCache()
        setFailure(error)
      }
    }

    function playSource(source: string) {
      audio.src = source
      audio.playbackRate = speech ? rate : 1
      audio.onplaying = started
      audio.onended = () => complete()
      audio.onerror = () => complete('unavailable')
      void audio.play().catch((error: unknown) => {
        complete(error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'unavailable')
      })
    }

    function started() {
      window.clearTimeout(timeout)
      if (current.current === playback) setPreparing(false)
    }

    function streamProgress() {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => complete('unavailable'), 10_000)
    }

    function cache(blob: Blob) {
      const source = URL.createObjectURL(blob)
      cached.current = { url, source }
      return source
    }

    if (!speech) {
      playSource(url)
    } else if (cached.current?.url === url) {
      playSource(cached.current.source)
    } else {
      clearCache()
      const request = (accept: string) => fetch(url, { signal: controller.signal, headers: { Accept: accept } })
      // WebKit can resolve resume() after the session request has already returned.
      const stream = !wavOnly && context && typeof ReadableStream !== 'undefined'
      void request(stream ? pcmStreamType : 'audio/wav').then(async (response) => {
        if (current.current !== playback) return
        if (response.headers.get('Content-Type') === pcmStreamType) {
          if (context && context.state !== 'running' && resuming.current) {
            await Promise.race([resuming.current, new Promise((resolve) => window.setTimeout(resolve, 200))])
            if (current.current !== playback) return
          }
          if (response.ok && context?.state === 'running' && response.body) {
            context.addEventListener('statechange', checkContext)
            pcm = createPcmPlayback(context, rate, () => setPreparing(false), complete)
            const blob = await pcm.read(response.body, streamProgress)
            if (current.current !== playback) return
            window.clearTimeout(timeout)
            cache(blob)
            pcm.finish()
            return
          }
          void response.body?.cancel().catch(() => {})
          response = await request('audio/wav')
        }
        if (!response.ok) throw new Error('Voice request failed')
        const blob = await response.blob()
        if (current.current !== playback) return
        playSource(cache(blob))
      }).catch(() => complete('unavailable'))
    }
  }

  function play(url: string, text: string, done?: (finished: boolean) => void) {
    playAudio(url, text, done)
  }

  function replay(url: string, text: string) {
    if (cached.current?.url !== url) prime()
    playAudio(url, text, undefined, failure === 'unavailable')
  }

  function playEndTone() {
    playAudio('/sounds/call-ended.wav', null)
  }

  function toggle(url: string, text: string) {
    setEnabled(!enabled)
    if (enabled) {
      stop()
      setFailure(null)
    } else {
      replay(url, text)
    }
  }

  function isEcho(text: string) {
    const fragment = normalize(text)
    const recent = recentLine.current
    return Boolean(fragment && (current.current?.text.includes(fragment) ||
      (performance.now() < recent.until && recent.text.includes(fragment))))
  }

  return { enabled, rate, setRate, speaking, preparing, failure, prime, play, replay, playEndTone, stop, toggle, isEcho }
}
