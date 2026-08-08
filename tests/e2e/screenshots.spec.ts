import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const shouldCapture = process.env.CAPTURE_SCREENSHOTS === '1'
const asset = (name: string): string => resolve('docs/assets', name)

test.describe('release screenshots', () => {
  test.skip(!shouldCapture, 'Run with CAPTURE_SCREENSHOTS=1 to refresh committed product images')

  test.use({
    viewport: { width: 1440, height: 960 },
    colorScheme: 'dark'
  })

  test('dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('dashboard-view')).toBeVisible()
    await page.waitForTimeout(350)
    await page.screenshot({ path: asset('savepoint-dashboard.png'), fullPage: true })
  })

  test('checkpoint detail', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Queue persistence is wired/ }).click()
    await expect(page.getByTestId('checkpoint-detail')).toBeVisible()
    await page.waitForTimeout(350)
    await page.screenshot({ path: asset('savepoint-checkpoint-detail.png'), fullPage: true })
  })

  test('comparison', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Compare' }).click()
    await expect(page.getByTestId('compare-view')).toBeVisible()
    await page.waitForTimeout(350)
    await page.screenshot({ path: asset('savepoint-compare.png'), fullPage: true })
  })

  test('resume briefing', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Queue persistence is wired/ }).click()
    await page.getByRole('button', { name: 'Resume this session' }).click()
    await expect(page.getByTestId('resume-view')).toBeVisible()
    await page.waitForTimeout(350)
    await page.screenshot({ path: asset('savepoint-resume.png'), fullPage: true })
  })
})
