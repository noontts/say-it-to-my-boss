import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(track?: MediaStreamTrack): void
  abort(): void
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}

const browser = window as SpeechWindow
const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition

const microphonePermission = 'อนุญาตให้เว็บไซต์ใช้ไมโครโฟนในการตั้งค่าเบราว์เซอร์แล้วลองอีกครั้ง หากยังใช้ไม่ได้ ให้เปิดแอปใน Chrome หรือ Safari โดยตรง'
const voicePermission = 'เบราว์เซอร์ไม่อนุญาตให้แปลงเสียงเป็นข้อความ ลองเปิดแอปใน Chrome หรือ Safari โดยตรง'
const microphoneUnavailable = 'ใช้ไมโครโฟนไม่ได้ ตรวจการเชื่อมต่อไมโครโฟนแล้วลองอีกครั้ง'
const unavailable = 'แปลงเสียงเป็นข้อความไม่สำเร็จ ลองเปิดไมค์อีกครั้ง'

const errorMessages: Record<string, string> = {
  'not-allowed': voicePermission,
  'service-not-allowed': voicePermission,
  'audio-capture': microphoneUnavailable,
  'language-not-supported': 'เบราว์เซอร์แปลงเสียงภาษาไทยไม่ได้ ลองเปิดใน Chrome หรือ Safari',
}

type SpeechStatus = 'idle' | 'requesting' | 'listening'
type Capture = {
  stream?: MediaStream
  recognition?: Recognition
  timer?: number
  listen?: () => void
}
type SpeechCallbacks = {
  accept: (text: string) => boolean
  onInterim: (text: string) => boolean
  onComplete: (text: string) => void
}

const replyPause = 850
const restartDelay = 300

export function useSpeechToText(callbacks: SpeechCallbacks) {
  const active = useRef<Capture | null>(null)
  const latest = useRef(callbacks)
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')

  useLayoutEffect(() => { latest.current = callbacks }, [callbacks])

  const stop = useCallback(() => {
    const capture = active.current
    active.current = null
    window.clearTimeout(capture?.timer)
    capture?.recognition?.abort()
    capture?.stream?.getTracks().forEach((track) => track.stop())
    setStatus('idle')
    setPreview('')
  }, [])

  useEffect(() => stop, [stop])

  function discard() {
    const capture = active.current
    if (!capture?.listen) return
    window.clearTimeout(capture.timer)
    const recognition = capture.recognition
    capture.recognition = undefined
    recognition?.abort()
    setPreview('')
    capture.timer = window.setTimeout(capture.listen, restartDelay)
  }

  async function start() {
    if (!SpeechRecognition || active.current) return
    const Recognition = SpeechRecognition
    const capture: Capture = {}
    active.current = capture
    setError('')
    setStatus('requesting')

    function fail(message: string) {
      if (active.current !== capture) return
      stop()
      setError(message)
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (active.current !== capture) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        capture.stream = stream
      } catch (cause) {
        const denied = cause instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(cause.name)
        fail(denied ? microphonePermission : microphoneUnavailable)
        return
      }
    }

    function listen() {
      if (active.current !== capture) return
      try {
        const recognition = new Recognition()
        capture.recognition = recognition
        recognition.lang = 'th-TH'
        recognition.continuous = true
        recognition.interimResults = true

        let finalCount = 0
        let reply: string[] = []
        let interim = ''
        const current = () => active.current === capture && capture.recognition === recognition

        function submit() {
          window.clearTimeout(capture.timer)
          const text = reply.join(' ')
          reply = []
          interim = ''
          setPreview('')
          if (text) latest.current.onComplete(text)
        }

        recognition.onresult = (event) => {
          if (!current()) return
          const fragments: string[] = []
          const results = Array.from(event.results).slice(finalCount)
          for (const result of results) {
            if (result.isFinal) finalCount++
            const text = result[0].transcript.trim()
            if (!text || !latest.current.accept(text)) continue
            if (result.isFinal) reply.push(text)
            else fragments.push(text)
          }
          const nextInterim = fragments.join(' ')
          if (!nextInterim && !interim && !reply.length) return
          window.clearTimeout(capture.timer)
          const text = [...reply, nextInterim].filter(Boolean).join(' ')
          if (nextInterim && nextInterim !== interim && !latest.current.onInterim(text)) {
            reply = []
            interim = ''
            setPreview('')
            return
          }
          interim = nextInterim
          setPreview(text)
          if (!interim && reply.length) capture.timer = window.setTimeout(submit, replyPause)
        }

        function restart() {
          if (!current()) return
          capture.recognition = undefined
          submit()
          if (active.current === capture) capture.timer = window.setTimeout(listen, restartDelay)
        }

        recognition.onend = restart
        recognition.onerror = ({ error }) => {
          if (!current()) return
          if (error === 'no-speech') restart()
          else fail(errorMessages[error] ?? unavailable)
        }

        const track = capture.stream?.getAudioTracks()[0]
        if (track) recognition.start(track)
        else recognition.start()
        setStatus('listening')
      } catch (cause) {
        fail(cause instanceof DOMException && cause.name === 'NotAllowedError' ? voicePermission : unavailable)
      }
    }

    capture.listen = listen
    listen()
  }

  return { supported: Boolean(SpeechRecognition), status, error, preview, start, stop, discard }
}
