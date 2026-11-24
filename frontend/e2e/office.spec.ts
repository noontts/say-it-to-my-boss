import { test, expect, type Page } from '@playwright/test'
import { setupPractice } from './practice-fixture'

const opening = 'รายงานเลยกำหนดแล้ว พรุ่งนี้ผมต้องใช้ในที่ประชุม เกิดอะไรขึ้นครับ?'
const callbackOpening = 'เมื่อกี้ผมโทรไปแล้วคุณไม่ได้รับสาย ตอนนี้รายงานไปถึงไหนแล้วครับ?'
const firstReply = 'ขอโทษที่ส่งช้าค่ะ เพราะตัวเลขยังตรวจไม่เสร็จ ตอนนี้ทำสรุปแล้วค่ะ'
const replies = [
  firstReply,
  'ขอส่งบทสรุปก่อนห้าโมงเย็นค่ะ',
  'จะส่งฉบับเต็มพรุ่งนี้แปดโมงค่ะ ถ้าติดขัดจะแจ้งภายในหนึ่งทุ่ม',
]

const answer = (page: Page) => page.getByRole('button', { name: 'รับสาย', exact: true })
const callback = (page: Page) => page.getByRole('button', { name: 'โทรกลับ', exact: true })
const enter = (page: Page) => page.getByRole('button', { name: 'เข้าออฟฟิศ', exact: true })
const transcript = (page: Page) => page.getByRole('list', { name: 'บทสนทนา' })
const starts = '**/api/v1/sessions'

test.beforeEach(async ({ page }) => {
  await setupPractice(page)
  const start = new Date(2026, 0, 1).getTime()
  await page.clock.install({ time: start })
  await page.clock.pauseAt(start + 1_000)
})

async function openOffice(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /หัวหน้าเรียกคุย/ }).click()
  await enter(page).click()
  await page.clock.runFor(100)
  await expect(page.getByText(/WASD เดิน/)).toBeVisible()
}

async function walk(page: Page, key: string, duration: number) {
  await page.keyboard.down(key)
  await page.clock.runFor(duration)
  await page.keyboard.up(key)
}

async function atDesk(page: Page) {
  await walk(page, 'w', 1_250)
}

async function answerCall(page: Page) {
  await openOffice(page)
  await atDesk(page)
  await page.clock.fastForward(9_000)
  await answer(page).click()
  await expect(transcript(page)).toContainText(opening)
}

async function speak(page: Page, reply: string, turn: number) {
  await expect.poll(() => page.evaluate(() => window.practiceTest.recognitionStarts.length)).toBeGreaterThanOrEqual(turn)
  await page.evaluate((text) => window.practiceTest.emitSpeech(text, true), reply)
  await page.clock.runFor(900)
  await expect(transcript(page).getByRole('listitem')).toHaveCount(2 * turn + 1)
  await expect(transcript(page)).toContainText(reply)
  await page.clock.runFor(320)
}

test('the muted office alerts the player and accepts one desk answer in the last second', async ({ page }) => {
  const requests: unknown[] = []
  await page.route(starts, (route) => {
    requests.push(route.request().postDataJSON())
    return route.continue()
  })
  await openOffice(page)
  await page.getByRole('button', { name: 'ปิดเสียงเรียกเข้า' }).click()
  await page.clock.fastForward(10_020)
  await expect(page.getByText(/สายเรียกเข้าจากหัวหน้า/)).toBeVisible()
  await expect(answer(page)).toHaveCount(0)
  expect(requests).toHaveLength(0)
  await atDesk(page)
  await page.clock.fastForward(9_750)
  await expect(page.getByText(/เหลือ 1 วินาที/)).toBeVisible()
  await expect(answer(page)).toBeVisible()
  await page.keyboard.press('e')
  await expect(transcript(page)).toContainText(opening)
  expect(requests).toEqual([{ scenarioId: 'angry-boss', officeEntry: 'answer' }])
})

test('a failed answer retries the same branch after the deadline', async ({ page }) => {
  const requests: unknown[] = []
  await page.route(starts, (route) => {
    requests.push(route.request().postDataJSON())
    return requests.length === 1 ? route.fulfill({ status: 503 }) : route.continue()
  })
  await openOffice(page)
  await atDesk(page)
  await page.clock.fastForward(9_000)
  await answer(page).click()
  await expect(page.getByRole('alert')).toContainText('เริ่มฝึกไม่สำเร็จ')
  await page.clock.fastForward(13_000)
  await page.getByRole('button', { name: 'ลองเริ่มสายอีกครั้ง' }).click()
  await expect(transcript(page)).toContainText(opening)
  expect(requests).toEqual([
    { scenarioId: 'angry-boss', officeEntry: 'answer' },
    { scenarioId: 'angry-boss', officeEntry: 'answer' },
  ])
})

test('the farthest left corner can reach the phone within one ring', async ({ page }) => {
  await openOffice(page)
  await walk(page, 'a', 2_300)
  await walk(page, 's', 500)
  await page.clock.fastForward(7_300)
  await expect(page.getByText(/สายเรียกเข้าจากหัวหน้า/)).toBeVisible()
  await walk(page, 'd', 2_070)
  await walk(page, 'w', 1_605)
  await expect(answer(page)).toBeVisible()
  const countdown = await page.getByText(/เหลือ [1-9][0-9]* วินาที/).textContent()
  expect(Number(countdown?.match(/\d+/)?.[0])).toBeGreaterThanOrEqual(7)
})

test('an expired ring starts nothing and callback takes the missed-call branch', async ({ page }) => {
  const requests: unknown[] = []
  await page.route(starts, (route) => {
    requests.push(route.request().postDataJSON())
    return requests.length === 1 ? route.fulfill({ status: 503 }) : route.continue()
  })
  await openOffice(page)
  await page.clock.fastForward(22_100)
  await expect(page.getByText('ไม่ได้รับสายหัวหน้าทันเวลา')).toBeVisible()
  await expect(answer(page)).toHaveCount(0)
  await expect(callback(page)).toHaveCount(0)
  expect(requests).toHaveLength(0)
  await atDesk(page)
  await callback(page).click()
  await expect(page.getByRole('alert')).toContainText('เริ่มฝึกไม่สำเร็จ')
  await page.getByRole('button', { name: 'ลองเริ่มสายอีกครั้ง' }).click()
  await expect(transcript(page)).toContainText(callbackOpening)
  expect(requests).toEqual([
    { scenarioId: 'angry-boss', officeEntry: 'callback' },
    { scenarioId: 'angry-boss', officeEntry: 'callback' },
  ])
  await expect(page.getByRole('img', { name: 'หัวหน้ากำลังหงุดหงิด' })).toBeVisible()
})

test('report reading preserves the ring deadline and speech with references open follows silence rules', async ({ page }) => {
  await openOffice(page)
  await walk(page, 'a', 225)
  await atDesk(page)
  await page.getByRole('button', { name: 'อ่านรายงาน' }).click()
  await expect(page.getByRole('dialog', { name: 'รายงาน' })).toBeVisible()
  await page.clock.fastForward(9_000)
  await expect(page.getByText(/สายเรียกเข้าจากหัวหน้า/)).toBeVisible()
  await page.clock.fastForward(2_000)
  await expect(page.getByText(/เหลือ 10 วินาที/)).toBeVisible()
  await page.getByRole('button', { name: 'ปิดเอกสาร' }).click()
  await answer(page).click()
  await expect(transcript(page)).toContainText(opening)
  await page.getByText('เอกสารประกอบ', { exact: true }).click()
  await expect(page.getByText('โน้ตทีม', { exact: true })).toBeVisible()
  await speak(page, firstReply, 1)
  await expect(transcript(page)).toContainText('มีส่วนไหนที่ผมเอาไปเตรียมประชุมได้วันนี้บ้างครับ?')
  await page.getByRole('button', { name: 'เสียงคู่สนทนา' }).click()
  await page.clock.runFor(8_100)
  await expect(transcript(page)).toContainText('ทำไมยังไม่ตอบครับ?')
  await page.clock.runFor(8_100)
  await expect(page.getByRole('button', { name: 'ดูผลการฝึก' })).toBeVisible()
})

test('the desk view follows mood and NPC playback with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await answerCall(page)
  await expect(page.getByRole('region', { name: 'มุมมองโต๊ะทำงาน' })).toBeVisible()
  const portrait = page.getByRole('img', { name: 'หัวหน้ากำลังกังวล' })
  await expect(portrait).toHaveAttribute('data-speaking', 'true')
  await expect(portrait).toHaveCSS('animation-name', 'none')
  await page.getByRole('button', { name: 'เสียงคู่สนทนา' }).click()
  await expect(portrait).toHaveAttribute('data-speaking', 'false')
  await speak(page, replies[0], 1)
  await speak(page, replies[1], 2)
  await expect(page.getByRole('img', { name: 'หัวหน้าเริ่มสบายใจ' })).toBeVisible()
})

test('office sessions restore without enabling the microphone and replay resets the office clock', async ({ page }) => {
  await answerCall(page)
  const initialURL = page.url()
  await page.reload()
  await expect(transcript(page)).toContainText(opening)
  await expect(page.getByRole('region', { name: 'มุมมองโต๊ะทำงาน' })).toBeVisible()
  expect(await page.evaluate(() => window.practiceTest.microphoneRequests)).toBe(0)
  await page.getByRole('button', { name: 'เปิดไมค์', exact: true }).click()
  await page.getByRole('button', { name: 'เสียงคู่สนทนา' }).click()
  for (const [index, reply] of replies.entries()) await speak(page, reply, index + 1)
  await page.getByRole('button', { name: 'ดูผลการฝึก' }).click()
  const results = page.getByRole('region', { name: 'ผลการฝึก' })
  await expect(results).toContainText('ทำเป้าหมายสำเร็จ')
  await expect(results).toContainText('สิ่งที่ลองปรับได้')
  await page.reload()
  await expect(results).toContainText('ทำเป้าหมายสำเร็จ')
  await page.getByRole('button', { name: 'ฝึกอีกครั้ง' }).click()
  await expect(enter(page)).toBeVisible()
  await expect(page).not.toHaveURL(/session=/)
  await enter(page).click()
  await page.clock.runFor(100)
  await atDesk(page)
  await expect(answer(page)).toHaveCount(0)
  await page.clock.fastForward(9_000)
  await answer(page).click()
  await expect(transcript(page)).toContainText(opening)
  await expect(page).not.toHaveURL(initialURL)
})


test('a desktop without WebGL can still launch the direct practice call', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, type: string) => RenderingContext | null
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string) {
        return type === 'webgl' ? null : getContext.call(this, type)
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /หัวหน้าเรียกคุย/ }).click()
  await page.getByRole('button', { name: 'เริ่มคุย', exact: true }).click()
  await expect(transcript(page)).toContainText(opening)
  await expect(page.getByRole('region', { name: 'มุมมองโต๊ะทำงาน' })).toHaveCount(0)
})

test('the office phone plays from either side before mute and the visual timer continues', async ({ page }) => {
  await page.addInitScript(() => {
    const created: StereoPannerNode[] = []
    const createStereoPanner = AudioContext.prototype.createStereoPanner
    AudioContext.prototype.createStereoPanner = function () {
      const panner = createStereoPanner.call(this)
      created.push(panner)
      return panner
    }
    Object.defineProperty(window, 'officeRingPans', { get: () => created.map((node) => node.pan.value) })
  })
  const pans = () => page.evaluate(() => (window as Window & { officeRingPans?: number[] }).officeRingPans ?? [])
  await openOffice(page)
  await walk(page, 'a', 760)
  await page.clock.fastForward(9_300)
  await expect.poll(async () => (await pans()).at(-1)).toBeGreaterThan(0.25)
  await walk(page, 'd', 1_320)
  await page.clock.fastForward(180)
  await expect.poll(async () => (await pans()).at(-1)).toBeLessThan(-0.25)
  await page.getByRole('button', { name: 'ปิดเสียงเรียกเข้า' }).click()
  const audiblePulses = (await pans()).length
  await page.clock.fastForward(3_000)
  await expect(page.getByRole('timer')).toBeVisible()
  expect(await pans()).toHaveLength(audiblePulses)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`the desk camera honors ${reducedMotion} motion preferences`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await answerCall(page)
    const camera = page.getByLabel('มุมมองออฟฟิศ', { exact: true })
    await page.clock.runFor(16)
    const firstFrame = await camera.screenshot()
    await page.clock.runFor(400)
    const lastFrame = await camera.screenshot()
    expect(firstFrame.equals(lastFrame)).toBe(reducedMotion === 'reduce')
  })
}

test('an office portrait stays idle and the transcript remains available if NPC audio fails', async ({ page }) => {
  await page.route('**/api/v1/sessions/*/voice/*', (route) => route.fulfill({ status: 502 }))
  await answerCall(page)
  await expect(page.getByText('เล่นเสียงไม่ได้ อ่านคำตอบได้ในบทสนทนา')).toBeVisible()
  await expect(page.getByRole('img', { name: 'หัวหน้ากำลังกังวล' })).toHaveAttribute('data-speaking', 'false')
  await expect(transcript(page)).toContainText(opening)
})

test('office presentation keeps its portrait and references on fallback restore', async ({ page }) => {
  await answerCall(page)
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })
  })
  await page.reload()
  await expect(transcript(page)).toContainText(opening)
  await expect(page.getByRole('img', { name: 'หัวหน้ากำลังกังวล' })).toBeVisible()
  await page.getByText('เอกสารประกอบ', { exact: true }).click()
  await expect(page.getByText('โน้ตทีม', { exact: true })).toBeVisible()
})
