import { useEffect, useRef, useState } from 'react'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}

interface Recognition {
  lang: string
  continuous: boolean
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
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
const unavailable = 'แปลงเสียงเป็นข้อความไม่สำเร็จ ลองกดไมค์แล้วพูดอีกครั้ง'

const errorMessages: Record<string, string> = {
  'not-allowed': voicePermission,
  'service-not-allowed': voicePermission,
  'audio-capture': microphoneUnavailable,
  'no-speech': 'ไม่ได้ยินเสียง ลองกดไมค์แล้วพูดอีกครั้ง',
  'language-not-supported': 'เบราว์เซอร์แปลงเสียงภาษาไทยไม่ได้ ลองเปิดใน Chrome หรือ Safari',
}

type SpeechStatus = 'idle' | 'requesting' | 'listening' | 'stopping'

export function useSpeechToText(onComplete: (text: string) => void) {
  const active = useRef<{ recognition?: Recognition } | null>(null)
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [error, setError] = useState('')

  useEffect(() => () => {
    const attempt = active.current
    active.current = null
    attempt?.recognition?.abort()
  }, [])

  async function start() {
    if (!SpeechRecognition || active.current) return
    const attempt: { recognition?: Recognition } = {}
    active.current = attempt
    setError('')

    function reset() {
      if (active.current !== attempt) return false
      active.current = null
      setStatus('idle')
      return true
    }

    if (navigator.mediaDevices?.getUserMedia) {
      setStatus('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // SpeechRecognition opens its own stream. Release the permission probe first.
        stream.getTracks().forEach((track) => track.stop())
      } catch (cause) {
        if (!reset()) return
        const denied = cause instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(cause.name)
        setError(denied ? microphonePermission : microphoneUnavailable)
        return
      }
    }
    if (active.current !== attempt) return

    try {
      const recognition = new SpeechRecognition()
      attempt.recognition = recognition
      recognition.lang = 'th-TH'
      recognition.continuous = false
      let transcript = ''
      recognition.onresult = (event) => {
        if (active.current !== attempt) return
        transcript = Array.from(event.results)
          .filter((result) => result.isFinal)
          .map((result) => result[0].transcript.trim())
          .filter(Boolean)
          .join(' ')
      }
      recognition.onerror = (event) => {
        if (reset()) setError(errorMessages[event.error] ?? unavailable)
      }
      recognition.onend = () => {
        if (!reset()) return
        if (transcript) {
          onComplete(transcript)
        } else {
          setError(errorMessages['no-speech'])
        }
      }
      setStatus('listening')
      recognition.start()
    } catch (cause) {
      if (!reset()) return
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? voicePermission : unavailable)
    }
  }

  function stop() {
    const recognition = active.current?.recognition
    if (!recognition || status !== 'listening') return
    setStatus('stopping')
    try {
      recognition.stop()
    } catch {
      active.current = null
      setStatus('idle')
      setError(unavailable)
    }
  }

  return { supported: Boolean(SpeechRecognition), status, error, start, stop }
}
