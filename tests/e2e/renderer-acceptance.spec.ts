import { expect, test, type Page } from '@playwright/test'

const demoOrigin = 'http://127.0.0.1:4173'

async function openSettings(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

test('onboarding explains manual capture and keeps automatic checkpoints opt-in', async ({
  page
}) => {
  await page.goto('/?fresh=1')

  const onboarding = page.getByTestId('onboarding')
  await expect(onboarding).toBeVisible()
  await expect(onboarding).toContainText(/manual checkpoints?/i)
  await expect(onboarding).toContainText(/automatic checkpoints?/i)
  await expect(onboarding).toContainText(
    /opt[- ]?in|off by default|disabled by default|only (?:starts?|runs?) when enabled/i
  )

  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(onboarding).toContainText(/system folder picker/i)
  await expect(onboarding).toContainText(/never uploads/i)
})

test('compare switches repository scope and reports file status transitions', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Compare', exact: true }).click()

  const compare = page.getByTestId('compare-view')
  const repository = compare.getByRole('combobox', { name: 'Repository', exact: true })
  await expect(repository).toHaveValue('repo-orbit-notes')

  await repository.selectOption('repo-forge-cli')
  await expect(compare).toContainText(/forge-cli/i)
  await expect(compare.getByLabel('Earlier checkpoint')).toHaveValue('cp-forge-package-plan')
  await expect(compare.getByLabel('Later checkpoint')).toHaveValue('cp-forge-release')

  await repository.selectOption('repo-orbit-notes')
  await compare
    .getByLabel('Earlier checkpoint')
    .selectOption({ label: 'Offline creation baseline' })
  await compare.getByLabel('Later checkpoint').selectOption({ label: 'Queue persistence is wired' })

  const transitions = compare.getByRole('heading', { name: /status transitions?/i }).locator('..')
  await expect(transitions).toContainText('src/sync/mutation-queue.ts')
  await expect(transitions).toContainText(/added/i)
  await expect(transitions).toContainText(/modified/i)
  await expect(compare).toContainText(
    /captured file metadata|does not store or compare source contents/i
  )
})

test('resume uses the generated briefing for drift, commands, links, and copy actions', async ({
  context,
  page
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: demoOrigin })
  await page.goto('/')
  await page.getByRole('button', { name: /^Timeline/ }).click()
  await page.getByRole('button', { name: /Sync boundary mapped/ }).click()
  await page.getByRole('button', { name: 'Resume this session' }).click()

  const resume = page.getByTestId('resume-view')
  await expect(resume).toBeVisible()
  await expect(resume.getByRole('heading', { name: 'Sync boundary mapped' })).toBeVisible()
  const drift = resume.getByTestId('resume-drift')
  await expect(drift.getByText('Current state differs from this checkpoint')).toBeVisible()
  await expect(resume).toContainText('325ccb1')
  await expect(resume).toContainText('61a2e8b')
  await expect(
    resume.getByRole('button', { name: 'Copy command rg "mutateNote" src' })
  ).toBeVisible()
  await expect(
    resume.getByRole('button', {
      name: 'Open link https://github.com/example/orbit-notes/discussions/71'
    })
  ).toBeVisible()

  await resume.getByRole('button', { name: 'Copy checkpoint Markdown' }).click()
  await expect(page.getByRole('status')).toContainText(/markdown copied/i)
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('## Repository now')

  await resume.getByRole('button', { name: 'Copy assistant context' }).click()
  await expect(page.getByRole('status')).toContainText(/assistant context copied/i)
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Resume development checkpoint "Sync boundary mapped"')
})

test('dialogs trap focus and restore it to their launch controls', async ({ page }) => {
  await page.goto('/')

  const createButton = page.getByTestId('create-checkpoint')
  await createButton.click()
  const composer = page.getByRole('dialog', { name: 'Create checkpoint' })
  const closeComposer = composer.getByRole('button', { name: 'Close Create checkpoint' })
  const saveCheckpoint = composer.getByRole('button', { name: 'Save checkpoint' })
  await expect(page.getByLabel(/Checkpoint title/)).toBeFocused()

  await closeComposer.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(saveCheckpoint).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeComposer).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(composer).toBeHidden()
  await expect(createButton).toBeFocused()

  const detailButton = page.getByRole('button', { name: /Queue persistence is wired/ })
  await detailButton.click()
  const detail = page.getByRole('dialog', { name: 'Queue persistence is wired' })
  const closeDetail = detail.getByRole('button', { name: 'Close checkpoint detail' })
  const finalDetailAction = detail.getByRole('button', {
    name: /https:\/\/github\.com\/example\/orbit-notes\/issues\/184/i
  })
  await expect(closeDetail).toBeFocused()

  await closeDetail.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(finalDetailAction).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeDetail).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(detailButton).toBeFocused()
})

test('settings and header advertise cross-platform shortcut modifiers', async ({ page }) => {
  await openSettings(page)

  const shortcuts = page.locator('.shortcut-list')
  const create = shortcuts.locator('> div').filter({ hasText: 'Create checkpoint' })
  const search = shortcuts.locator('> div').filter({ hasText: 'Search checkpoints' })
  await expect(create.locator('kbd')).toHaveText(['Ctrl/⌘', 'N'])
  await expect(search.locator('kbd')).toHaveText(['Ctrl/⌘', 'K'])
  await expect(page.locator('.header-actions kbd')).toHaveText(['Ctrl/⌘ K', 'Ctrl/⌘ N'])
})
