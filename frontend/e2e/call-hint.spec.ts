import { expect, test } from '@playwright/test'
import { setupPractice } from './practice-fixture'

const scenario = {
  id: 'difficult-customer',
  title: 'ลูกค้าขอคืนเงินเกินกำหนด',
  profession: 'ค้าปลีกและบริการลูกค้า',
  description: 'ลูกค้าต้องการคืนสินค้าที่พ้นกำหนดคืนเงิน',
  playable: true,
}

test('the call hint opens and closes without interrupting a voice reply', async ({ page }) => {
  await setupPractice(page)
  await page.route('**/api/v1/scenarios', (route) => route.fulfill({ json: { scenarios: [scenario] } }))
  await page.goto('/')

  await page.getByRole('button', { name: 'เริ่มเกม', exact: true }).click()
  await page.getByRole('button', { name: 'รับสาย', exact: true }).click()

  const hint = page.locator('.call-hint')
  const hintButton = hint.getByRole('button', { name: 'Hint', exact: true })
  await expect(hintButton).toHaveAttribute('aria-expanded', 'false')
  await expect(hint.getByText('แนวทางการคุย')).toBeHidden()

  await hintButton.click()
  await expect(hintButton).toHaveAttribute('aria-expanded', 'true')
  await expect(hint).toContainText('รับฟังและแสดงความเข้าใจที่ลูกค้าต้องเสียเวลา')
  await hintButton.click()
  await expect(hintButton).toHaveAttribute('aria-expanded', 'false')

  await expect(page.getByRole('button', { name: 'ปิดไมค์', exact: true })).toBeVisible()
  await page.evaluate(() => window.practiceTest.emitSpeech('ขอโทษที่ต้องเสียเวลานะคะ', true))
  const transcript = page.getByRole('list', { name: 'บทสนทนา' })
  await expect(transcript).toContainText('ขอโทษที่ต้องเสียเวลานะคะ')
  await expect(transcript.getByRole('listitem')).toHaveCount(3)
  await expect.poll(() => page.evaluate(() => window.practiceTest.played.some((clip) => /\/voice\/2$/.test(clip.path))))
    .toBe(true)
})
