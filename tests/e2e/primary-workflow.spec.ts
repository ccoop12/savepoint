import { expect, test } from '@playwright/test'

test('add a repository, create a checkpoint, inspect it, and export it', async ({ page }) => {
  await page.goto('/?fresh=1')

  await expect(page.getByTestId('onboarding')).toBeVisible()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: /Choose Git repository/ }).click()

  await expect(page.getByTestId('dashboard-view')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'pixel-forge' })).toBeVisible()

  await page.getByTestId('create-checkpoint').click()
  await page.getByLabel(/Checkpoint title/).fill('Canvas export has a stable seam')
  await page.getByLabel(/Current goal/).fill('Ship reliable high-resolution canvas export.')
  await page
    .getByLabel(/Work completed/)
    .fill('Separated layout from encoding and added fixture coverage.')
  await page.getByLabel(/Next action/).fill('Exercise cancellation while the encoder is active.')
  await page.getByLabel('Tags').fill('export, canvas, needs-test')
  await page.getByRole('button', { name: 'Save checkpoint' }).click()

  const detail = page.getByTestId('checkpoint-detail')
  await expect(detail).toBeVisible()
  await expect(
    detail.getByRole('heading', { name: 'Canvas export has a stable seam' })
  ).toBeVisible()
  await expect(detail.getByText('src/export/canvas-writer.ts')).toBeVisible()

  await detail.getByRole('button', { name: /Export/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Markdown/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.md$/)
  await expect(page.getByRole('status')).toContainText('Markdown exported')

  await detail.getByRole('button', { name: 'Close checkpoint detail' }).click()
  await page.getByRole('button', { name: /^Timeline/ }).click()
  await expect(page.getByTestId('timeline-view')).toContainText('Canvas export has a stable seam')
})

test('keyboard shortcuts open capture, search, and close overlays', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dashboard-view')).toBeVisible()

  await page.keyboard.press('t')
  await expect(page.getByTestId('dashboard-view')).toBeVisible()
  await page.keyboard.press('g')
  await page.keyboard.press('t')
  await expect(page.getByTestId('timeline-view')).toBeVisible()

  await page.keyboard.press('Control+N')
  await expect(page.getByRole('dialog', { name: 'Create checkpoint' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Create checkpoint' })).toBeHidden()

  await page.keyboard.press('Control+K')
  await expect(page.getByPlaceholder('Search goals, files, tags…')).toBeFocused()
})

test('light appearance preference is applied to the real application shell', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'light', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})
