import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    streamingTest: {
      started: number
      finish: (truncate?: boolean) => void
    }
    practiceTest: {
      emitSpeech: (text: string, isFinal: boolean) => void
      endRecognition: () => void
      interruptionRoll: number
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

const scenarios = [
  {
    id: 'angry-boss',
    title: /หัวหน้าเรียกคุย/,
    replies: [
      'ขอโทษที่ส่งช้าค่ะ เพราะตัวเลขยังตรวจไม่เสร็จ ตอนนี้ทำสรุปแล้วค่ะ',
      'ขอส่งบทสรุปก่อนห้าโมงเย็นค่ะ',
      'จะส่งฉบับเต็มพรุ่งนี้แปดโมงค่ะ ถ้าติดขัดจะแจ้งภายในหนึ่งทุ่ม',
    ],
  },
  {
    id: 'demanding-client',
    title: /ลูกค้าเร่งให้ส่งงาน/,
    replies: [
      'เข้าใจว่าต้องเปิดตัววันจันทร์ค่ะ ทีมทำไฟล์ทั้งหมดไม่ทัน',
      'ส่งภาพหลักวันศุกร์ก่อนบ่ายสามโมงค่ะ',
      'ส่วนที่เหลือจะส่งภายในวันอังคาร และจะอัปเดตความคืบหน้าวันจันทร์ค่ะ',
    ],
  },
  {
    id: 'difficult-customer',
    title: /ลูกค้าขอคืนเงิน/,
    replies: [
      'ขอโทษที่คุณต้องเสียเวลานะคะ',
      'ตอนนี้พ้นกำหนดคืนเงินแล้วค่ะ',
      'ขอใบเสร็จเพื่อเช็กประกันและตรวจเครื่อง แล้วจะติดต่อแจ้งผลพรุ่งนี้ค่ะ',
    ],
  },
]

// A short PCM WAV exercises browser decoding without loading TTS models for each test.
const sampleRate = 8000
const sampleCount = sampleRate
const testSpeech = Buffer.alloc(44 + sampleCount * 2)
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

test.beforeEach(async ({ page }) => {
  if (!process.env.TEST_REAL_TTS) {
    await page.route('**/api/v1/sessions/*/voice/*', (route) =>
      route.fulfill({ body: testSpeech, contentType: 'audio/wav' }))
  }
  await page.addInitScript(() => {
    const state: Window['practiceTest'] = {
      emitSpeech: () => {},
      endRecognition: () => {},
      interruptionRoll: 1,
      denyMicrophone: false,
      recognitionError: '',
      microphoneRequests: 0,
      releasedTracks: 0,
      recognitionStarts: [],
      played: [],
      audioPlayers: 0,
    }
    window.practiceTest = state
    Math.random = () => state.interruptionRoll

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
})

async function startCall(page: Page, title: RegExp, microphoneStarts = true) {
  await page.goto('/')
  if (!microphoneStarts) await page.evaluate(() => { window.practiceTest.denyMicrophone = true })
  await page.getByRole('button', { name: title }).click()
  await page.getByRole('button', { name: 'เริ่มคุย', exact: true }).click()
  await expect(page.getByRole('button', { name: microphoneStarts ? 'ปิดไมค์' : 'เปิดไมค์', exact: true })).toBeEnabled()
}

async function speak(page: Page, transcript: string, isFinal = true) {
  await page.evaluate(({ text, final }) => window.practiceTest.emitSpeech(text, final), { text: transcript, final: isFinal })
}

async function expectRecognitionStarts(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => window.practiceTest.recognitionStarts))
    .toEqual(Array<string>(count).fill('th-TH'))
}

async function expectClip(page: Page, path: string, rate = 1) {
  await expect.poll(() => page.evaluate(() => window.practiceTest.played.at(-1))).toEqual({ path, rate })
}

function voicePath(page: Page, line: number | string) {
  const id = new URL(page.url()).searchParams.get('session')
  return `/api/v1/sessions/${id}/voice/${line}`
}

const endTone = '/sounds/call-ended.wav'

for (const scenario of scenarios) {
  test(`${scenario.id} completes a voice call and saves results`, async ({ page }) => {
    await startCall(page, scenario.title)
    const initialURL = page.url()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expectClip(page, voicePath(page, 0))

    for (const [turn, reply] of scenario.replies.entries()) {
      await expectRecognitionStarts(page, turn + 1)
      await speak(page, reply)
      await expectClip(page, voicePath(page, (turn + 1) * 2))
    }

    const transcript = page.locator('.voice-call').getByRole('list', { name: 'บทสนทนา' })
    await expect(transcript.getByRole('listitem')).toHaveCount(7)
    await expect(transcript).toContainText(scenario.replies[2])
    await expect.poll(() => page.evaluate(() => [
      window.practiceTest.microphoneRequests, window.practiceTest.releasedTracks,
    ])).toEqual([1, 1])

    await page.getByRole('button', { name: 'ดูผลการฝึก' }).click()
    await expectClip(page, endTone)
    const results = page.getByRole('region', { name: 'ผลการฝึก' })
    await expect(results).toContainText('ทำเป้าหมายสำเร็จ')
    await expect(results.getByText('สิ่งที่ลองปรับได้')).toBeVisible()
    await page.reload()
    await expect(results).toContainText('ทำเป้าหมายสำเร็จ')

    await page.getByRole('button', { name: 'ฝึกอีกครั้ง' }).click()
    await expect(page.getByText(/รอบที่ 1 \/ 3/)).toBeVisible()
    await expect(page).not.toHaveURL(initialURL)
  })
}

test('the microphone recovers from a denied permission and a speech error without an end event', async ({ page }) => {
  await startCall(page, scenarios[0].title, false)
  const microphone = page.getByRole('button', { name: 'เปิดไมค์' })
  await expect(page.getByRole('alert')).toContainText('อนุญาตให้เว็บไซต์ใช้ไมโครโฟน')
  expect(await page.evaluate(() => window.practiceTest.recognitionStarts)).toHaveLength(0)
  await expect(microphone).toBeEnabled()

  await page.evaluate(() => {
    window.practiceTest.denyMicrophone = false
    window.practiceTest.recognitionError = 'not-allowed'
  })
  await microphone.click()
  await expect(page.getByRole('alert')).toContainText('Chrome หรือ Safari')
  await expect(microphone).toBeEnabled()

  await microphone.click()
  await expect(page.getByRole('button', { name: 'ปิดไมค์' })).toBeEnabled()
  await speak(page, scenarios[0].replies[0])
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
  expect(await page.evaluate(() => ({
    requests: window.practiceTest.microphoneRequests,
    released: window.practiceTest.releasedTracks,
  }))).toEqual({ requests: 3, released: 1 })
})

test('a failed voice reply can be retried without dictating it again', async ({ page }) => {
  const submissions: unknown[] = []
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    submissions.push(route.request().postDataJSON())
    if (submissions.length === 1) {
      await route.fulfill({ status: 502, json: { error: 'Bad Gateway' } })
      return
    }
    await route.continue()
  })

  await startCall(page, scenarios[0].title)
  const reply = scenarios[0].replies[0]
  const interim = 'ขอโทษที่ส่งช้า'
  const transcript = page.locator('.voice-call').getByRole('list', { name: 'บทสนทนา' })
  await speak(page, interim, false)
  await expect(transcript.getByText(interim, { exact: true })).toBeVisible()
  expect(submissions).toHaveLength(0)
  await speak(page, reply)
  await expect(page.getByRole('alert')).toContainText('ส่งคำตอบไม่สำเร็จ')
  await expect(transcript.getByText(reply, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ลองส่งอีกครั้ง' }).click()
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
  await expect(transcript.getByText(reply, { exact: true })).toHaveCount(1)
  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toEqual(submissions[0])
})

test('playback can be muted and unmuted at a different speed', async ({ page }) => {
  await startCall(page, scenarios[0].title)
  const opening = voicePath(page, 0)
  await expectClip(page, opening)
  const speaker = page.getByRole('button', { name: 'เสียงคู่สนทนา' })
  await expect(page.getByRole('button', { name: /ฟัง(เสียง)?อีกครั้ง/ })).toHaveCount(0)
  await page.getByLabel('ความเร็วเสียง').selectOption('1.2')
  await speaker.click()
  await expect(speaker).toHaveAttribute('aria-pressed', 'false')
  await speaker.click()
  await expect(speaker).toHaveAttribute('aria-pressed', 'true')
  await expectClip(page, opening, 1.2)
})

test('a tap plays the opening after autoplay is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    // Register after test setup so the first generated clip is blocked before decoding.
    window.addEventListener('DOMContentLoaded', () => {
      const play = HTMLMediaElement.prototype.play
      let blocked = false
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (this.src.startsWith('blob:') && !blocked) {
          blocked = true
          return Promise.reject(new DOMException('Tap required', 'NotAllowedError'))
        }
        return play.call(this)
      }
    })
  })
  const requests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.includes('/voice/')) requests.push(path)
  })

  await startCall(page, scenarios[1].title)
  const opening = voicePath(page, 0)
  const play = page.getByRole('button', { name: 'เล่นเสียง', exact: true })
  await expect(play).toBeVisible()
  await play.tap()
  await expectClip(page, opening)
  await expect(play).toHaveCount(0)
  expect(requests).toEqual([opening])
  expect(await page.evaluate(() => window.practiceTest.audioPlayers)).toBe(1)
})

for (const truncated of [false, true]) {
  test(`streams a saved NPC reply${truncated ? ' and recovers from a dropped stream' : ''}`, async ({ page }) => {
    test.skip(truncated && Boolean(process.env.TEST_REAL_TTS), 'The truncated response is a browser fixture')
    const real = Boolean(process.env.TEST_REAL_TTS)
    const streamType = 'application/vnd.angry-boss.pcm'
    await page.addInitScript(({ real, streamType }) => {
      const state = { started: 0, finish: (_truncate?: boolean) => {} }
      window.streamingTest = state
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
        state.started++
        start.call(this, when, offset, duration)
      }
      if (real) return
      const fetch = window.fetch
      window.fetch = (input, init) => {
        if (String(input).endsWith('/voice/2') && new Headers(init?.headers).get('Accept') === streamType) {
          return Promise.resolve(new Response(new ReadableStream({
            start(controller) {
              const frame = new Uint8Array(4 + 24_000)
              new DataView(frame.buffer).setUint32(0, frame.length - 4, true)
              controller.enqueue(frame.slice(0, 2))
              controller.enqueue(frame.slice(2))
              state.finish = (truncate = false) => {
                if (!truncate) {
                  controller.enqueue(frame)
                  controller.enqueue(new Uint8Array(4))
                }
                controller.close()
              }
            },
          }), { headers: { 'Content-Type': streamType } }))
        }
        return fetch(input, init)
      }
    }, { real, streamType })

    const scenario = scenarios[1]
    await startCall(page, scenario.title)
    if (real) await expect.poll(() => page.evaluate(() => window.streamingTest.started)).toBeGreaterThan(0)
    else await expectClip(page, voicePath(page, 0))
    const openingChunks = await page.evaluate(() => window.streamingTest.started)
    const response = real ? page.waitForResponse((res) => res.url().endsWith('/voice/2')) : null
    await speak(page, scenario.replies[0])
    await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.streamingTest.started)).toBeGreaterThan(openingChunks)

    if (response) {
      expect((await response).headers()['content-type']).toBe(streamType)
      return
    }

    expect(await page.evaluate(() => window.streamingTest.started)).toBe(1)
    await page.evaluate((truncate) => window.streamingTest.finish(truncate), truncated)
    if (truncated) {
      await expect(page.getByText(/เล่นเสียงไม่ได้/)).toBeVisible()
      await page.getByRole('button', { name: 'ลองเล่นเสียงอีกครั้ง' }).tap()
      await expectClip(page, voicePath(page, 2))
    } else {
      await expect.poll(() => page.evaluate(() => window.streamingTest.started)).toBe(2)
    }
  })
}

test('the player can type a reply when microphone access is denied', async ({ page }) => {
  await startCall(page, scenarios[1].title, false)
  await expectClip(page, voicePath(page, 0))
  await page.getByLabel('พิมพ์คำตอบ').fill(scenarios[1].replies[0])
  await page.getByRole('button', { name: 'ส่งคำตอบ' }).tap()
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
  await expectClip(page, voicePath(page, 2))
})

for (const variant of [
  { name: 'brief interjection', roll: 0.25, cue: 'interjection', takesFloor: false },
  { name: 'takeover', roll: 0.05, cue: 'takeover', takesFloor: true },
]) {
  test(`the boss can cut in with a ${variant.name} during live speech`, async ({ page }) => {
    const submissions: { text: string }[] = []
    await page.route('**/api/v1/sessions/*/messages', async (route) => {
      submissions.push(route.request().postDataJSON())
      await route.continue()
    })
    await startCall(page, scenarios[0].title)
    await expectClip(page, voicePath(page, 0))
    await page.evaluate((roll) => { window.practiceTest.interruptionRoll = roll }, variant.roll)

    const intro = 'ขอโทษที่ส่งช้าค่ะ'
    const reply = scenarios[0].replies[0]
    await speak(page, intro, false)
    await expect(page.getByText(intro, { exact: true })).toBeVisible()
    let update = 0
    await expect.poll(async () => {
      await speak(page, `${reply} ${++update}`, false)
      return page.getByText(/ · พูดแทรก$/).count()
    }).toBe(1)
    await expectClip(page, voicePath(page, variant.cue))
    await expect(page.getByRole('button', { name: 'ปิดไมค์' })).toBeEnabled()

    if (variant.takesFloor) {
      const ignored = 'ยังพูดไม่จบค่ะ ขออธิบายเพิ่ม'
      await expect(page.getByRole('status')).toContainText('รอให้พูดจบ')
      await speak(page, ignored)
      await expectRecognitionStarts(page, 2)
      await expect(page.getByText(ignored, { exact: true })).toHaveCount(0)
      expect(submissions).toHaveLength(0)
    }

    await speak(page, reply)
    await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
    expect(submissions.map(({ text }) => text)).toEqual([reply])
    expect(await page.evaluate(() => window.practiceTest.microphoneRequests)).toBe(1)
  })
}

test('continuous listening resumes after a browser end event and respects mute', async ({ page }) => {
  await startCall(page, scenarios[0].title)
  await expectClip(page, voicePath(page, 0))
  await speak(page, 'รายงานเลยกำหนดแล้ว') // The opening clip leaking into the microphone.
  await page.evaluate(() => window.practiceTest.endRecognition())
  await expectRecognitionStarts(page, 2)
  await expect(page.getByText(/รอบที่ 1 \/ 3/)).toBeVisible()

  await page.getByRole('button', { name: 'ปิดไมค์' }).click()
  await speak(page, scenarios[0].replies[0])
  await expect(page.getByText(scenarios[0].replies[0], { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.practiceTest.releasedTracks)).toBe(1)

  await page.getByRole('button', { name: 'เปิดไมค์' }).click()
  await expectRecognitionStarts(page, 3)
  await speak(page, scenarios[0].replies[0])
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
})

test('a reply after the reminder keeps the call open', async ({ page }) => {
  await page.clock.install()
  await startCall(page, scenarios[0].title)
  await expectClip(page, voicePath(page, 0))
  await expect(page.getByRole('status')).toHaveText('กำลังฟัง…', { timeout: 10_000 })

  const reminder = page.getByText('ทำไมยังไม่ตอบครับ?', { exact: true })
  await page.clock.fastForward(7000)
  await expect(reminder).toHaveCount(0)
  await page.clock.fastForward(1000)
  await expect(reminder).toBeVisible()
  await expectClip(page, voicePath(page, 'reminder'))
  await expect(page.getByRole('button', { name: 'ปิดไมค์' })).toBeEnabled()
  await expect(page.getByRole('status')).toHaveText('กำลังฟัง…')

  await page.clock.fastForward(7000)
  await expect(reminder).toHaveCount(1)
  await expect(page.getByText(/รอบที่ 1 \/ 3/)).toBeVisible()

  await speak(page, scenarios[0].replies[0])
  await page.clock.fastForward(850)
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
  await expect(reminder).toBeVisible()
})

test('the boss prompts and hangs up after silence even with the mic muted', async ({ page }) => {
  await page.clock.install()
  await startCall(page, scenarios[0].title)
  await expectClip(page, voicePath(page, 0))
  await page.getByRole('button', { name: 'ปิดไมค์' }).click()
  await expect(page.getByRole('status')).toHaveText('ไมค์ปิดอยู่', { timeout: 10_000 })
  await page.clock.fastForward(8000)
  await expectClip(page, voicePath(page, 'reminder'))
  await expect(page.getByRole('status')).toHaveText('ไมค์ปิดอยู่')

  const goodbye = page.getByText('งั้นไว้ค่อยคุยกันครับ', { exact: true })
  await page.clock.fastForward(7000)
  await expect(goodbye).toHaveCount(0)
  await page.clock.fastForward(1000)
  await expectClip(page, voicePath(page, 2))
  await expect(page.getByRole('status')).toHaveText('หัวหน้ากำลังวางสาย…')
  await expect(goodbye).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('หัวหน้าวางสายแล้ว')
  await expectClip(page, endTone)
  expect(await page.evaluate(() => window.practiceTest.played.at(-2)?.path)).toBe(voicePath(page, 2))
  await expect(page.getByRole('button', { name: /เปิดไมค์|ปิดไมค์/ })).toHaveCount(0)
  expect(await page.evaluate(() => window.practiceTest.releasedTracks)).toBe(1)

  await page.reload()
  await expect(page.getByRole('status')).toHaveText('หัวหน้าวางสายแล้ว')
  await expect(goodbye).toBeVisible()
  await expect(page.getByText('ทำไมยังไม่ตอบครับ?', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'ดูผลการฝึก' }).click()
  await expect(page.getByRole('region', { name: 'ผลการฝึก' })).toBeVisible()
})

test('the boss waits while a reply is in progress', async ({ page }) => {
  await page.clock.install()
  await startCall(page, scenarios[0].title)
  await expectClip(page, voicePath(page, 0))
  const reminder = page.getByText('ทำไมยังไม่ตอบครับ?', { exact: true })
  const reply = scenarios[0].replies[0]
  await speak(page, reply, false)
  await expect(page.getByText(reply, { exact: true })).toBeVisible()
  await page.clock.fastForward(16_000)
  await expect(reminder).toHaveCount(0)

  await speak(page, reply)
  await page.clock.fastForward(850)
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
})

test('the player can hang up while a reply is pending and still view results', async ({ page }) => {
  let releaseReply = () => {}
  const answerPending = new Promise<void>((resolve) => { releaseReply = resolve })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    await answerPending
    await route.abort()
  })
  await startCall(page, scenarios[1].title)
  await expectClip(page, voicePath(page, 0))
  await speak(page, scenarios[1].replies[0])
  await expect(page.getByRole('status')).toHaveText('กำลังตอบ…')
  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('คุณวางสายแล้ว')
  await expectClip(page, endTone)
  releaseReply()
  await expect(page.getByRole('button', { name: /เปิดไมค์|ปิดไมค์/ })).toHaveCount(0)
  expect(await page.evaluate(() => window.practiceTest.releasedTracks)).toBe(1)

  await page.reload()
  await expect(page.getByRole('status')).toHaveText('คุณวางสายแล้ว')
  expect(await page.evaluate(() => window.practiceTest.played)).toHaveLength(0)
  await page.getByRole('button', { name: 'ดูผลการฝึก' }).click()
  await expect(page.getByRole('region', { name: 'ผลการฝึก' })).toBeVisible()
})

test('an unavailable speech worker leaves the closing reply visible and plays the end tone', async ({ page }) => {
  await page.route('**/api/v1/sessions/*/voice/6', (route) => route.fulfill({ status: 502 }))
  const closingLine = 'ขอบคุณค่ะ เราตกลงตามนี้นะคะ'
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    const response = await route.fetch()
    const session = await response.json()
    if (session.status !== 'active') session.messages.at(-1).text = closingLine
    await route.fulfill({ response, json: { ...session, mode: 'ai' } })
  })
  const scenario = scenarios[1]
  await startCall(page, scenario.title)
  for (const [turn, reply] of scenario.replies.entries()) {
    await expectRecognitionStarts(page, turn + 1)
    await speak(page, reply)
  }
  await expect(page.getByText(closingLine)).toBeVisible()
  await expect(page.getByText(/เล่นเสียงไม่ได้/)).toBeVisible()
  await expectClip(page, endTone)
  await page.unroute('**/api/v1/sessions/*/voice/6')
  await page.getByRole('button', { name: 'ลองเล่นเสียงอีกครั้ง' }).tap()
  await expectClip(page, voicePath(page, 6))
})

test('an early AI hang-up plays the closing line before the end tone', async ({ page }) => {
  const closingLine = 'งั้นฉันจะจองคิวทีมไว้วันอังคารค่ะ'
  await page.route('**/api/v1/sessions', async (route) => {
    const response = await route.fetch()
    const session = await response.json()
    await route.fulfill({ response, json: { ...session, mode: 'ai', turnLimit: undefined } })
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    const response = await route.fetch()
    const session = await response.json()
    session.messages.at(-1).text = closingLine
    await route.fulfill({ response, json: {
      ...session, mode: 'ai', turnLimit: undefined, status: 'needs_practice', endReason: 'npc',
    } })
  })

  const scenario = scenarios[1]
  await startCall(page, scenario.title)
  await expect(page.getByText('รอบที่ 1', { exact: true })).toBeVisible()
  await speak(page, scenario.replies[0])
  await expect(page.getByText(closingLine)).toBeVisible()
  await expect(page.getByRole('button', { name: /เปิดไมค์|ปิดไมค์/ })).toHaveCount(0)
  await expectClip(page, voicePath(page, 2))
  await expectClip(page, endTone)
  await expect(page.getByRole('status')).toHaveText('คู่สนทนาวางสายแล้ว')
  await expect(page.getByRole('button', { name: 'ดูผลการฝึก' })).toBeEnabled()
  const paths = await page.evaluate(() => window.practiceTest.played.map(({ path }) => path))
  expect(paths.at(-2)).toMatch(/\/voice\/2$/)
})
