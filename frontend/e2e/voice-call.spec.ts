import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    practiceTest: {
      transcript: string
      denyMicrophone: boolean
      recognitionError: string
      microphoneRequests: number
      releasedTracks: number
      recognitionStarts: string[]
      played: { path: string; rate: number }[]
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: Window['practiceTest'] = {
      transcript: '',
      denyMicrophone: false,
      recognitionError: '',
      microphoneRequests: 0,
      releasedTracks: 0,
      recognitionStarts: [],
      played: [],
    }
    window.practiceTest = state

    // Simulate the input hardware while exercising the real audio player and app.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async (constraints: MediaStreamConstraints) => {
        if (constraints.audio) state.microphoneRequests++
        if (state.denyMicrophone) throw new DOMException('Microphone denied', 'NotAllowedError')
        return { getTracks: () => [{ stop: () => { state.releasedTracks++ } }] }
      },
    })

    class Recognition {
      lang = ''
      onerror?: (event: { error: string }) => void
      onresult?: (event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void
      onend?: () => void

      start() {
        state.recognitionStarts.push(this.lang)
        if (state.recognitionError) {
          const error = state.recognitionError
          state.recognitionError = ''
          queueMicrotask(() => this.onerror?.({ error }))
        }
      }

      stop() {
        this.onresult?.({ results: [{ isFinal: true, 0: { transcript: state.transcript } }] })
        this.onend?.()
      }

      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition })

    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      this.volume = 0
      this.addEventListener('playing', () => {
        state.played.push({ path: new URL(this.currentSrc).pathname, rate: this.playbackRate })
      }, { once: true })
      return play.call(this)
    }
  })
})

async function startCall(page: Page, title: RegExp) {
  await page.goto('/')
  await page.getByRole('button', { name: title }).click()
  await page.getByRole('button', { name: 'เริ่มคุย', exact: true }).click()
  await expect(page.getByRole('button', { name: 'กดเพื่อพูด' })).toBeEnabled()
}

async function speak(page: Page, transcript: string) {
  await page.evaluate((text) => { window.practiceTest.transcript = text }, transcript)
  await page.getByRole('button', { name: 'กดเพื่อพูด' }).click()
  await expect(page.getByRole('status')).toHaveText('กำลังฟัง…')
  await page.getByRole('button', { name: 'หยุดและส่ง' }).click()
}

async function expectClip(page: Page, path: string, rate = 1) {
  await expect.poll(() => page.evaluate(() => window.practiceTest.played.at(-1))).toEqual({ path, rate })
}

for (const scenario of scenarios) {
  test(`${scenario.id} completes a voice call and saves results`, async ({ page }) => {
    await startCall(page, scenario.title)
    const initialURL = page.url()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expectClip(page, `/voices/${scenario.id}-0.mp3`)

    for (const [turn, reply] of scenario.replies.entries()) {
      await speak(page, reply)
      await expectClip(page, `/voices/${scenario.id}-${turn + 1}.mp3`)
    }

    await page.getByText('บทสนทนา', { exact: true }).click()
    const transcript = page.getByRole('list', { name: 'บทสนทนา' })
    await expect(transcript.getByRole('listitem')).toHaveCount(7)
    await expect(transcript).toContainText(scenario.replies[2])
    expect(await page.evaluate(() => window.practiceTest.recognitionStarts)).toEqual(['th-TH', 'th-TH', 'th-TH'])

    await page.getByRole('button', { name: 'ดูผลการฝึก' }).click()
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
  await startCall(page, scenarios[0].title)
  const microphone = page.getByRole('button', { name: 'กดเพื่อพูด' })
  await page.evaluate(() => { window.practiceTest.denyMicrophone = true })
  await microphone.click()
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

  await speak(page, scenarios[0].replies[0])
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
  expect(await page.evaluate(() => ({
    requests: window.practiceTest.microphoneRequests,
    released: window.practiceTest.releasedTracks,
  }))).toEqual({ requests: 3, released: 2 })
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
  await speak(page, scenarios[0].replies[0])
  await expect(page.getByRole('alert')).toContainText('ส่งคำตอบไม่สำเร็จ')
  await expect(page.getByText(scenarios[0].replies[0], { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ลองส่งอีกครั้ง' }).click()
  await expect(page.getByText(/รอบที่ 2 \/ 3/)).toBeVisible()
  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toEqual(submissions[0])
})

test('playback can be muted, unmuted, and replayed at a different speed', async ({ page }) => {
  await startCall(page, scenarios[0].title)
  const opening = '/voices/angry-boss-0.mp3'
  await expectClip(page, opening)
  const speaker = page.getByRole('button', { name: 'เสียงคู่สนทนา' })
  await speaker.click()
  await expect(speaker).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'ฟังอีกครั้ง' })).toBeHidden()
  await speaker.click()
  await expect(speaker).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('ความเร็วเสียง').selectOption('1.2')
  await page.getByRole('button', { name: 'ฟังอีกครั้ง' }).click()
  await expectClip(page, opening, 1.2)
})
