import type { Page } from '@playwright/test'

declare global {
  interface Window {
    practiceTest: {
      emitSpeech: (text: string, isFinal: boolean) => void
      endRecognition: () => void
      interruptionRoll: number | null
      denyMicrophone: boolean
      recognitionError: string
      microphoneRequests: number
      releasedTracks: number
      recognitionStarts: string[]
      played: { path: string; rate: number }[]
      audioPlayers: number
    }
  }
}

// A short PCM WAV exercises browser decoding without loading TTS models for each test.
const sampleRate = 8000
const sampleCount = sampleRate
export const testSpeech = Buffer.alloc(44 + sampleCount * 2)
testSpeech.write('RIFF', 0)
testSpeech.writeUInt32LE(testSpeech.length - 8, 4)
testSpeech.write('WAVEfmt ', 8)
testSpeech.writeUInt32LE(16, 16)
testSpeech.writeUInt16LE(1, 20)
testSpeech.writeUInt16LE(1, 22)
testSpeech.writeUInt32LE(sampleRate, 24)
testSpeech.writeUInt32LE(sampleRate * 2, 28)
testSpeech.writeUInt16LE(2, 32)
testSpeech.writeUInt16LE(16, 34)
testSpeech.write('data', 36)
testSpeech.writeUInt32LE(sampleCount * 2, 40)

export async function setupPractice(page: Page) {
  if (!process.env.TEST_REAL_TTS) {
    await page.route('**/api/v1/sessions/*/voice/*', (route) =>
      route.fulfill({ body: testSpeech, contentType: 'audio/wav' }))
  }
  await page.addInitScript(() => {
    const state: Window['practiceTest'] = {
      emitSpeech: () => {},
      endRecognition: () => {},
      interruptionRoll: null,
      denyMicrophone: false,
      recognitionError: '',
      microphoneRequests: 0,
      releasedTracks: 0,
      recognitionStarts: [],
      played: [],
      audioPlayers: 0,
    }
    window.practiceTest = state
    const random = Math.random
    Math.random = () => state.interruptionRoll ?? random()

    // Simulate the input hardware while exercising the real audio player and app.
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async (constraints: MediaStreamConstraints) => {
        if (constraints.audio) state.microphoneRequests++
        if (state.denyMicrophone) throw new DOMException('Microphone denied', 'NotAllowedError')
        const track = { stop: () => { state.releasedTracks++ } }
        return { getTracks: () => [track], getAudioTracks: () => [track] }
      } },
    })

    type Result = { isFinal: boolean; 0: { transcript: string } }
    class Recognition {
      lang = ''
      interimResults = false
      onerror?: (event: { error: string }) => void
      results: Result[] = []
      onresult?: (event: { results: Result[] }) => void
      onend?: () => void

      start() {
        state.recognitionStarts.push(this.lang)
        if (state.recognitionError) {
          const error = state.recognitionError
          state.recognitionError = ''
          queueMicrotask(() => this.onerror?.({ error }))
        }
        state.emitSpeech = (transcript, isFinal) => {
          const result = { isFinal, 0: { transcript } }
          const results = [...this.results, result]
          if (isFinal) this.results.push(result)
          this.onresult?.({ results })
        }
        state.endRecognition = () => this.onend?.()
      }

      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition })

    // Track fetched audio through its blob URL while keeping the real decoder and player.
    const blobs = new WeakMap<Blob, string>()
    const sources = new Map<string, string>()
    const responseBlob = Response.prototype.blob
    Response.prototype.blob = async function () {
      const blob = await responseBlob.call(this)
      blobs.set(blob, new URL(this.url).pathname)
      return blob
    }
    const objectURL = URL.createObjectURL
    URL.createObjectURL = function (blob) {
      const source = objectURL.call(URL, blob)
      const path = blob instanceof Blob ? blobs.get(blob) : undefined
      if (path) sources.set(source, path)
      return source
    }

    const players = new WeakSet<HTMLMediaElement>()
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!players.has(this)) {
        state.audioPlayers++
        players.add(this)
      }
      this.volume = 0
      const source = this.src
      const rate = this.playbackRate
      const started = play.call(this)
      if (!source.startsWith('data:')) {
        void started.then(() => {
          state.played.push({ path: sources.get(source) ?? new URL(source).pathname, rate })
        }, () => {})
      }
      return started
    }
  })
}
