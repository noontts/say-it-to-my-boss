import { expect, test } from '@playwright/test'
import { setupPractice } from './practice-fixture'

test.beforeEach(({ page }) => setupPractice(page))

test('a random round only connects on Answer and retries the same caller', async ({ page }) => {
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
  const incoming = page.getByRole('region', { name: 'สายเรียกเข้า' })
  await expect(incoming.locator('img')).toHaveAttribute('src', '/avatars/demanding-client.jpg')
  expect((await incoming.boundingBox())?.height).toBeGreaterThanOrEqual(await page.evaluate(() => innerHeight))
  expect(requests).toHaveLength(0)
  expect(await page.evaluate(() => window.practiceTest.microphoneRequests)).toBe(0)

  const answer = page.getByRole('button', { name: 'รับสาย', exact: true })
  await answer.click()
  await expect(page.getByRole('alert')).toContainText('เริ่มฝึกไม่สำเร็จ')
  await expect(answer).toBeFocused()
  await expect(incoming.locator('img')).toHaveAttribute('src', '/avatars/demanding-client.jpg')
  await answer.click()
  await expect(page.getByRole('list', { name: 'บทสนทนา' })).toBeVisible()
  expect(requests).toEqual([{ scenarioId: 'demanding-client' }, { scenarioId: 'demanding-client' }])

  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  await expect(page.getByRole('region', { name: 'คะแนนการฝึก' })).toContainText('0 / 100')
  const firstURL = page.url()
  await page.getByRole('button', { name: 'เล่นต่อ' }).click()
  await expect(incoming.locator('img')).toHaveAttribute('src', '/avatars/demanding-client.jpg')
  await expect(page).not.toHaveURL(/session=/)
  await answer.click()
  await expect(page).toHaveURL(/session=/)
  expect(page.url()).not.toBe(firstURL)
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
  const incoming = page.getByRole('region', { name: 'สายเรียกเข้า' })
  await expect(incoming.locator('img')).toHaveAttribute('src', '/avatars/angry-boss.jpg')
  await page.getByRole('button', { name: 'รับสาย', exact: true }).click()
  await page.getByRole('button', { name: 'วางสาย', exact: true }).click()
  const score = page.getByRole('region', { name: 'คะแนนการฝึก' })
  await expect(score).toContainText('0 / 100')
  await page.reload()
  await expect(score).toContainText('0 / 100')
  await page.evaluate(() => { Math.random = () => 0 })
  await page.getByRole('button', { name: 'เล่นต่อ' }).click()
  await expect(incoming).toBeVisible()
  await expect(incoming.locator('img')).toHaveAttribute('src', '/avatars/demanding-client.jpg')
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
  await page.getByRole('button', { name: 'รับสาย', exact: true }).click()
  await expect(page.getByRole('list', { name: 'บทสนทนา' })).toBeVisible()
})
