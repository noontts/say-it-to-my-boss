import { test, expect, type Page } from '@playwright/test'
import { setupPractice } from './practice-fixture'

const opening = 'รายงานเลยกำหนดแล้ว พรุ่งนี้ผมต้องใช้ในที่ประชุม เกิดอะไรขึ้นครับ?'
const callbackOpening = 'เมื่อกี้ผมโทรไปแล้วคุณไม่ได้รับสาย ตอนนี้รายงานไปถึงไหนแล้วครับ?'
const replies = [
  'ขอโทษที่ส่งช้าค่ะ เพราะตัวเลขยังตรวจไม่เสร็จ ตอนนี้ทำสรุปแล้วค่ะ',
  'ขอส่งบทสรุปก่อนห้าโมงเย็นค่ะ',
]
const answer = (page: Page) => page.getByRole('button', { name: 'รับสาย', exact: true })
const transcript = (page: Page) => page.getByRole('list', { name: 'บทสนทนา' })
const desk = (page: Page) => page.getByRole('region', { name: 'มุมมองโต๊ะทำงาน' })

test.beforeEach(async ({ page }) => {
  await setupPractice(page)
  await page.route('**/api/v1/scenarios', async (route) => {
    const response = await route.fetch()
    const catalog = await response.json()
    catalog.scenarios = catalog.scenarios.filter((scenario: { id: string }) => scenario.id === 'angry-boss')
    await route.fulfill({ response, json: catalog })
  })
})

async function showIncomingCall(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'เริ่มเกม', exact: true }).click()
}

async function answerCall(page: Page) {
  await showIncomingCall(page)
  await answer(page).click()
  await expect(transcript(page)).toContainText(opening)
}

async function speak(page: Page, reply: string, turn: number) {
  await expect.poll(() => page.evaluate(() => window.practiceTest.recognitionStarts.length)).toBeGreaterThanOrEqual(turn)
  await page.evaluate((text) => window.practiceTest.emitSpeech(text, true), reply)
  await expect(transcript(page).getByRole('listitem')).toHaveCount(2 * turn + 1)
  await expect(transcript(page)).toContainText(reply)
}

test('answering the boss starts one desk session after the player acts', async ({ page }) => {
  const requests: unknown[] = []
  await page.route('**/api/v1/sessions', (route) => {
    requests.push(route.request().postDataJSON())
    return route.continue()
  })
  await showIncomingCall(page)
  await expect(page.getByRole('heading', { name: 'สายเรียกเข้า' })).toBeFocused()
  await expect(answer(page)).toBeVisible()
  expect(requests).toHaveLength(0)
  await answer(page).click()
  await expect(transcript(page)).toContainText(opening)
  await expect(desk(page)).toBeVisible()
  expect(requests).toEqual([{ scenarioId: 'angry-boss', officeEntry: 'answer' }])
})

test('references stay available while replying at the desk', async ({ page }) => {
  await answerCall(page)
  await page.getByText('เอกสารประกอบ', { exact: true }).click()
  await expect(page.getByText('โน้ตทีม', { exact: true })).toBeVisible()
  await speak(page, replies[0], 1)
  await expect(transcript(page)).toContainText('มีส่วนไหนที่ผมเอาไปเตรียมประชุมได้วันนี้บ้างครับ?')
})

test('the desk portrait follows mood and NPC playback with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await answerCall(page)
  await expect(desk(page)).toBeVisible()
  const portrait = page.getByRole('img', { name: 'หัวหน้ากำลังกังวล' })
  await expect(portrait).toHaveAttribute('data-speaking', 'true')
  await expect(portrait).toHaveCSS('animation-name', 'none')
  await page.getByRole('button', { name: 'เสียงคู่สนทนา' }).click()
  await expect(portrait).toHaveAttribute('data-speaking', 'false')
  await speak(page, replies[0], 1)
  await speak(page, replies[1], 2)
  await expect(page.getByRole('img', { name: 'หัวหน้าเริ่มสบายใจ' })).toBeVisible()
})

test('office sessions restore at the desk without enabling the microphone', async ({ page }) => {
  await answerCall(page)
  await page.reload()
  await expect(transcript(page)).toContainText(opening)
  await expect(desk(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'เปิดไมค์', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.practiceTest.microphoneRequests)).toBe(0)
})

test('an existing callback session restores its original opening and mood', async ({ page, request }) => {
  const response = await request.post('/api/v1/sessions', {
    data: { scenarioId: 'angry-boss', officeEntry: 'callback' },
  })
  expect(response.ok()).toBe(true)
  const { id } = await response.json()
  await page.goto('/?scenario=angry-boss&session=' + id)
  await expect(transcript(page)).toContainText(callbackOpening)
  await expect(desk(page)).toBeVisible()
  await expect(page.getByRole('img', { name: 'หัวหน้ากำลังหงุดหงิด' })).toBeVisible()
})

test('a desktop without WebGL can still answer and use office references', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })
  })
  await answerCall(page)
  await expect(desk(page)).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'หัวหน้ากำลังกังวล' })).toBeVisible()
  await page.getByText('เอกสารประกอบ', { exact: true }).click()
  await expect(page.getByText('โน้ตทีม', { exact: true })).toBeVisible()
})

test('the desk portrait stays idle and the transcript remains available if NPC audio fails', async ({ page }) => {
  await page.route('**/api/v1/sessions/*/voice/*', (route) => route.fulfill({ status: 502 }))
  await answerCall(page)
  await expect(page.getByText('เล่นเสียงไม่ได้ อ่านคำตอบได้ในบทสนทนา')).toBeVisible()
  await expect(page.getByRole('img', { name: 'หัวหน้ากำลังกังวล' })).toHaveAttribute('data-speaking', 'false')
  await expect(transcript(page)).toContainText(opening)
})
