import { expect, test } from '@playwright/test'
import { setupPractice, walkToPhone } from './practice-fixture'

test.beforeEach(({ page }) => setupPractice(page))

test('a random round reveals the caller only after a successful Answer', async ({ page }) => {
  await page.clock.install()
  const requests: unknown[] = []
  await page.route('**/api/v1/scenarios', async (route) => {
    const response = await route.fetch()
    const catalog = await response.json()
    catalog.scenarios = catalog.scenarios.map((scenario: { id: string; playable: boolean }) =>
      ({ ...scenario, playable: scenario.id === 'demanding-client' }))
    await route.fulfill({ response, json: catalog })
  })
  await page.route('**/api/v1/sessions', (route) => {
    requests.push(route.request().postDataJSON())
    return requests.length === 1 ? route.fulfill({ status: 503 }) : route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'เริ่มเกม' }).click()
  const office = page.getByRole('region', { name: 'ออฟฟิศ', exact: true })
  await expect(office.getByText('เดินสำรวจออฟฟิศระหว่างรอสาย')).toBeVisible()
  expect((await office.boundingBox())?.height).toBeGreaterThanOrEqual(await page.evaluate(() => innerHeight))
  expect(requests).toHaveLength(0)
  expect(await page.evaluate(() => window.practiceTest.microphoneRequests)).toBe(0)

  const answer = await walkToPhone(page)
  const caller = page.getByRole('heading', { name: 'คุณเมย์ · ลูกค้าโครงการ', exact: true })
  await expect(office.getByRole('status')).toHaveText('สายเรียกเข้า')
  await expect(office.getByText(/คุณเมย์/)).toHaveCount(0)
  await answer.click()
  await expect(page.getByRole('alert')).toContainText('เริ่มฝึกไม่สำเร็จ')
  await expect(answer).toBeFocused()
  await expect(office.getByRole('status')).toHaveText('สายเรียกเข้า')
  await expect(caller).toHaveCount(0)
  await answer.click()
  await expect(caller).toBeVisible()
  expect(requests).toEqual([{ scenarioId: 'demanding-client' }, { scenarioId: 'demanding-client' }])

  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('0 / 100')
  const firstURL = page.url()
  await expect(page.getByRole('button', { name: 'เล่นต่อ' })).toHaveCount(0)
  await expect(office.getByText('เดินสำรวจออฟฟิศระหว่างรอสาย')).toBeVisible()
  await expect(page).toHaveURL(firstURL)
  await page.keyboard.down('s')
  await page.clock.runFor(1_100)
  await page.keyboard.up('s')
  await page.clock.fastForward(5_000)
  await expect(office.getByText('เดินไปที่โต๊ะเพื่อรับสาย')).toBeVisible()
  await expect(answer).toHaveCount(0)
  await (await walkToPhone(page)).click()
  await expect(page).not.toHaveURL(firstURL)
})

test('a finished round restores its score and the next call excludes the previous scenario', async ({ page }) => {
  let coachingRequests = 0
  await page.route('**/api/v1/sessions/*/finish', (route) => {
    coachingRequests++
    return route.abort()
  })
  await page.goto('/')
  await page.evaluate(() => { Math.random = () => 0 })
  await page.getByRole('button', { name: 'เริ่มเกม' }).click()
  const office = page.getByRole('region', { name: 'ออฟฟิศ', exact: true })
  const answer = await walkToPhone(page)
  await expect(office.getByRole('status')).toHaveText('สายเรียกเข้า')
  await answer.click()
  await expect(page.getByRole('heading', { name: /พี่นนท์/ })).toBeVisible()
  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  const score = page.getByRole('region', { name: 'คะแนนการฝึก' })
  await expect(score).toContainText('0 / 100')
  await page.reload()
  await expect(score).toContainText('0 / 100')
  await expect(page.getByRole('button', { name: 'เล่นต่อ' })).toHaveCount(0)
  await expect(office.getByText('เดินสำรวจออฟฟิศระหว่างรอสาย')).toBeVisible()
  const nextAnswer = await walkToPhone(page)
  await expect(office.getByRole('status')).toHaveText('สายเรียกเข้า')
  await nextAnswer.click()
  await expect(page.getByRole('heading', { name: /คุณเมย์|คุณอ้อย/ })).toBeVisible()
  expect(coachingRequests).toBe(0)
})

test('catalog failures can be retried and an empty playable catalog stays on the start screen', async ({ page }) => {
  let catalogAvailable = false
  await page.route('**/api/v1/scenarios', (route) => {
    return catalogAvailable ? route.fulfill({ json: { scenarios: [] } }) : route.fulfill({ status: 503 })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('โหลดสถานการณ์ไม่สำเร็จ')
  catalogAvailable = true
  await page.getByRole('button', { name: 'ลองใหม่' }).click()
  await expect(page.getByText('ยังไม่มีสถานการณ์ให้เล่น')).toBeVisible()
  await expect(page.getByRole('button', { name: 'เริ่มเกม' })).toHaveCount(0)
})

test('a missing session offers a fresh answer and clears its expired link', async ({ page }) => {
  await page.goto('/?scenario=demanding-client&session=missing')
  await expect(page.getByRole('alert')).toContainText('ไม่พบการฝึกเดิม')
  await expect(page).not.toHaveURL(/session=/)
  const incoming = page.getByRole('region', { name: 'สายเรียกเข้า', exact: true })
  await expect(incoming.getByText(/คุณเมย์/)).toHaveCount(0)
  await expect(incoming.locator('img')).toHaveCount(0)
  await page.getByRole('button', { name: 'รับสาย', exact: true }).click()
  await expect(page.getByRole('heading', { name: /คุณเมย์/ })).toBeVisible()
})

test('the on-screen movement control can reach the desk on mobile', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'เริ่มเกม' }).click()
  const forward = page.getByRole('button', { name: 'เดินหน้า', exact: true })
  await expect(forward).toBeVisible()
  const box = await forward.boundingBox()
  if (!box) throw new Error('The movement control is outside the viewport')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    await expect(page.getByRole('button', { name: 'รับสาย', exact: true })).toBeVisible({ timeout: 8_000 })
  } finally {
    await page.mouse.up()
  }
})
