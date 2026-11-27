import { expect, test, type Page } from '@playwright/test'

import { setupPractice, testSpeech, walkToPhone } from './practice-fixture'

declare global {
  interface Window {
    streamingTest: {
      started: number
      finish: (truncate?: boolean) => void
    }
  }
}

const scenarios = [
  {
    id: 'angry-boss',
    replies: [
      'ขอโทษที่ส่งช้าค่ะ เพราะตัวเลขยังตรวจไม่เสร็จ ตอนนี้ทำสรุปแล้วค่ะ',
      'ขอส่งบทสรุปก่อนห้าโมงเย็นค่ะ',
      'จะส่งฉบับเต็มพรุ่งนี้แปดโมงค่ะ ถ้าติดขัดจะแจ้งภายในหนึ่งทุ่ม',
    ],
  },
  {
    id: 'demanding-client',
    replies: [
      'เข้าใจว่าต้องเปิดตัววันจันทร์ค่ะ ทีมทำไฟล์ทั้งหมดไม่ทัน',
      'ส่งภาพหลักวันศุกร์ก่อนบ่ายสามโมงค่ะ',
      'ส่วนที่เหลือจะส่งภายในวันอังคาร และจะอัปเดตความคืบหน้าวันจันทร์ค่ะ',
    ],
  },
  {
    id: 'difficult-customer',
    replies: [
      'ขอโทษที่คุณต้องเสียเวลานะคะ',
      'ตอนนี้พ้นกำหนดคืนเงินแล้วค่ะ',
      'ขอใบเสร็จเพื่อเช็กประกันและตรวจเครื่อง แล้วจะติดต่อแจ้งผลพรุ่งนี้ค่ะ',
    ],
  },
]

test.beforeEach(({ page }) => setupPractice(page))

async function startCall(page: Page, scenarioId: string, microphoneStarts = true) {
  await page.route('**/api/v1/scenarios', async (route) => {
    const response = await route.fetch()
    const catalog = await response.json()
    catalog.scenarios = catalog.scenarios.filter((scenario: { id: string }) => scenario.id === scenarioId)
    await route.fulfill({ response, json: catalog })
  })
  await page.goto('/')
  if (!microphoneStarts) await page.evaluate(() => { window.practiceTest.denyMicrophone = true })
  await page.getByRole('button', { name: 'เริ่มเกม', exact: true }).click()
  await (await walkToPhone(page)).click()
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
  test(`${scenario.id} completes a voice call and restores its score`, async ({ page }) => {
    await startCall(page, scenario.id)
    const initialURL = page.url()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expectClip(page, voicePath(page, 0))

    const transcript = page.getByRole('list', { name: 'บทสนทนา' })
    for (const [turn, reply] of scenario.replies.entries()) {
      await expectRecognitionStarts(page, turn + 1)
      await speak(page, reply)
      await expectClip(page, voicePath(page, (turn + 1) * 2))
      if (turn < scenario.replies.length - 1) await expect(transcript).toContainText(reply)
    }

    await expect.poll(() => page.evaluate(() => [
      window.practiceTest.microphoneRequests, window.practiceTest.releasedTracks,
    ])).toEqual([1, 1])

    await expectClip(page, endTone)
    const score = page.getByRole('region', { name: 'คะแนนการฝึก' })
    await expect(score).toContainText('100 / 100')
    await page.reload()
    await expect(score).toContainText('100 / 100')

    await expect(page.getByRole('region', { name: 'ออฟฟิศ', exact: true })).toBeVisible()
    await (await walkToPhone(page)).click()
    await expect(page.getByText(/รอบที่ 1 \/ 3/)).toBeVisible()
    await expect(page).not.toHaveURL(initialURL)
  })
}

test('the microphone recovers from a denied permission and a speech error without an end event', async ({ page }) => {
  await startCall(page, scenarios[0].id, false)
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

  await startCall(page, scenarios[0].id)
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
  await startCall(page, scenarios[0].id)
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

  await startCall(page, scenarios[1].id)
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
    await startCall(page, scenario.id)
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
  await startCall(page, scenarios[1].id, false)
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
    await startCall(page, scenarios[0].id)
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
  await startCall(page, scenarios[0].id)
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
  await startCall(page, scenarios[0].id)
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
  await startCall(page, scenarios[0].id)
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
  await expectClip(page, endTone)
  expect(await page.evaluate(() => window.practiceTest.played.at(-2)?.path)).toBe(voicePath(page, 2))
  await expect(page.getByRole('button', { name: /เปิดไมค์|ปิดไมค์/ })).toHaveCount(0)
  expect(await page.evaluate(() => window.practiceTest.releasedTracks)).toBe(1)

  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('0 / 100')
  await page.reload()
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('0 / 100')
})

test('the boss waits while a reply is in progress', async ({ page }) => {
  await page.clock.install()
  await startCall(page, scenarios[0].id)
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

test('the player can hang up while a reply is pending and see the score', async ({ page }) => {
  let releaseReply = () => {}
  const answerPending = new Promise<void>((resolve) => { releaseReply = resolve })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    await answerPending
    await route.abort()
  })
  await startCall(page, scenarios[1].id)
  await expectClip(page, voicePath(page, 0))
  await speak(page, scenarios[1].replies[0])
  await expect(page.getByRole('status')).toHaveText('กำลังตอบ…')
  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('0 / 100')
  await expectClip(page, endTone)
  releaseReply()
  await expect(page.getByRole('button', { name: /เปิดไมค์|ปิดไมค์/ })).toHaveCount(0)
  expect(await page.evaluate(() => window.practiceTest.releasedTracks)).toBe(1)

  await page.reload()
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('0 / 100')
  expect(await page.evaluate(() => window.practiceTest.played)).toHaveLength(0)
})

test('manual hang-up shows a score of 66 for two of three objectives', async ({ page }) => {
  const scenario = scenarios[1]
  await startCall(page, scenario.id)
  for (const [turn, reply] of scenario.replies.slice(0, 2).entries()) {
    await expectRecognitionStarts(page, turn + 1)
    await speak(page, reply)
    await expectClip(page, voicePath(page, (turn + 1) * 2))
  }
  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('66 / 100')
})

test('a failed hang-up offers retry before the score appears', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/v1/sessions/*/hang-up', (route) => {
    attempts++
    return attempts === 1 ? route.fulfill({ status: 503 }) : route.continue()
  })
  await startCall(page, scenarios[1].id)
  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('บันทึกการวางสายไม่สำเร็จ')
  const score = page.getByRole('region', { name: 'คะแนนการฝึก' })
  await expect(score).toHaveCount(0)
  await page.getByRole('button', { name: 'บันทึกการวางสายอีกครั้ง' }).click()
  await expect(score).toContainText('0 / 100')
})

test('hang-up during a committed final reply preserves the closing audio', async ({ page }) => {
  let finalReplySaved!: () => void
  const finalReply = new Promise<void>((resolve) => { finalReplySaved = resolve })
  let release!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    if (route.request().postDataJSON().turn !== 2) return route.continue()
    const response = await route.fetch()
    expect((await response.json()).status).toBe('succeeded')
    finalReplySaved()
    await hold
    await route.fulfill({ response }).catch(() => {})
  })
  const scenario = scenarios[1]
  await startCall(page, scenario.id)
  for (const [turn, reply] of scenario.replies.entries()) {
    await expectRecognitionStarts(page, turn + 1)
    await speak(page, reply)
    if (turn < 2) await expectClip(page, voicePath(page, (turn + 1) * 2))
  }
  await finalReply
  try {
    await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
    await expectClip(page, voicePath(page, 6))
    await expectClip(page, endTone)
    await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('100 / 100')
  } finally {
    release()
  }
})

test('the score appears when the closing audio stream stops delivering frames', async ({ page }) => {
  const streamType = 'application/vnd.angry-boss.pcm'
  await page.clock.install()
  await page.addInitScript((type) => {
    const state = { started: 0, finish: () => {} }
    window.streamingTest = state
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      state.started++
      start.call(this, when, offset, duration)
    }
    const fetch = window.fetch
    window.fetch = (input, init) => {
      if (String(input).endsWith('/voice/6') && new Headers(init?.headers).get('Accept') === type) {
        const body = new ReadableStream({
          start(controller) {
            const frame = new Uint8Array(4 + 24_000)
            new DataView(frame.buffer).setUint32(0, frame.length - 4, true)
            controller.enqueue(frame)
          },
        })
        return Promise.resolve(new Response(body, { headers: { 'Content-Type': type } }))
      }
      return fetch(input, init)
    }
  }, streamType)
  const scenario = scenarios[1]
  await startCall(page, scenario.id)
  for (const [turn, reply] of scenario.replies.entries()) {
    await expectRecognitionStarts(page, turn + 1)
    await speak(page, reply)
    if (turn < 2) await expectClip(page, voicePath(page, (turn + 1) * 2))
  }
  const score = page.getByRole('region', { name: 'คะแนนการฝึก' })
  await expect(page.getByRole('status')).toHaveText('คู่สนทนากำลังวางสาย…')
  await expect.poll(() => page.evaluate(() => window.streamingTest.started)).toBe(1)
  await expect(score).toHaveCount(0)
  await page.clock.fastForward(10_100)
  await expect(score).toContainText('100 / 100')
  await expect(page.getByRole('region', { name: 'ออฟฟิศ', exact: true })).toBeVisible()
  await expect(score.getByRole('button')).toHaveCount(0)
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
  await startCall(page, scenario.id)
  for (const [turn, reply] of scenario.replies.entries()) {
    await expectRecognitionStarts(page, turn + 1)
    await speak(page, reply)
  }
  const score = page.getByRole('region', { name: 'คะแนนการฝึก' })
  await expect(score).toContainText(closingLine)
  await expectClip(page, endTone)
  await expect(score.getByRole('button')).toHaveCount(0)
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
  await startCall(page, scenario.id)
  await expect(page.getByText('รอบที่ 1', { exact: true })).toBeVisible()
  await speak(page, scenario.replies[0])
  await expect(page.getByText(closingLine)).toBeVisible()
  await expect(page.getByRole('button', { name: /เปิดไมค์|ปิดไมค์/ })).toHaveCount(0)
  await expectClip(page, voicePath(page, 2))
  await expectClip(page, endTone)
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('33 / 100')
  const paths = await page.evaluate(() => window.practiceTest.played.map(({ path }) => path))
  expect(paths.at(-2)).toMatch(/\/voice\/2$/)
})
