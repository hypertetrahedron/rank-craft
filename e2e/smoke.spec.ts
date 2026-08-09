import { expect, test } from '@playwright/test'

/**
 * End-to-end checks against a real browser.
 *
 * These exist because several defects only ever surfaced by driving the actual
 * app — completed runs vanishing on a hard navigation, a chart collapsing on a
 * degenerate distribution, the Pyodide worker failing to bundle. None of them
 * are visible to the type checker or to the Python suite.
 *
 * Booting Pyodide downloads ~10 MB, so the tests that run a simulation are slow
 * by nature and are given long timeouts rather than being made flaky.
 */

test.describe('the wizard', () => {
  test('opens on the field step with the defaults that avoid a ground-truth leak', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'The field' })).toBeVisible()

    await page.getByRole('button', { name: /^2\s*Skill$/ }).click()
    const panel = page.locator('details', { hasText: 'Seeding ratings' })
    await panel.locator('summary').click()
    // Perfect seeding makes seed order equal true-skill order, which every
    // tiebreak then reads. It must not be the default.
    await expect(panel.getByRole('button', { name: 'Imperfect' })).toHaveClass(/bg-accent/)

    await panel.getByRole('button', { name: 'Perfect', exact: true }).click()
    await expect(page.getByText(/Perfect seeding leaks the answer/)).toBeVisible()
  })

  test('warns when the round count makes a legal pairing impossible', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-field=players] input').fill('8')
    await page.locator('[data-field=rounds] input').fill('12')
    await expect(page.getByText(/impossible without rematches/)).toBeVisible()
  })

  test('renders the skill charts and reacts to the settings', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /^2\s*Skill$/ }).click()
    await expect(page.getByText('Skill distribution')).toBeVisible()
    await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()

    const gain = page.locator('[data-field=max-gain] input')
    const loss = page.locator('[data-field=max-loss] input')
    await gain.fill('0')
    await loss.fill('0')
    await expect(page.getByText(/Variance is zero/)).toBeVisible()
  })

  test('exposes the non-transitive matchup model', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /^2\s*Skill$/ }).click()
    const panel = page.locator('details', { hasText: 'Matchups' })
    await panel.locator('summary').click()
    await panel.getByRole('button', { name: 'Circular' }).click()
    await expect(panel.getByText(/rock-paper-scissors/).first()).toBeVisible()
  })

  test('loads the python editor with a real function and its reference', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /^3\s*Pairing$/ }).click()
    await expect(page.locator('.cm-content').first()).toContainText('def pair_round')
    await expect(page.getByText('Tournament (t)').first()).toBeVisible()
  })
})

test.describe('config links', () => {
  test('round-trip a setting through a shareable link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.locator('[data-field=seed] input').fill('4242')
    await page.getByRole('button', { name: 'Copy share link' }).click()
    await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()

    const link = await page.evaluate(() => navigator.clipboard.readText())
    expect(link).toContain('?c=')

    // A fresh browser context, so nothing comes from local storage.
    const other = await context.browser()!.newContext()
    const fresh = await other.newPage()
    await fresh.goto(link)
    await expect(fresh.getByText('Loaded a shared setup from the link.')).toBeVisible()
    await expect(fresh.locator('[data-field=seed] input')).toHaveValue('4242')
    await other.close()
  })
})

test.describe('running a simulation', () => {
  // Booting Pyodide is a ~10 MB download on a cold cache.
  test.setTimeout(10 * 60 * 1000)

  test('runs end to end and survives a hard reload', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-field=players] input').fill('16')
    await page.locator('[data-field=rounds] input').fill('4')

    await page.getByRole('button', { name: /^5\s*Run$/ }).click()
    await page.locator('[data-field=replications] input').fill('20')
    await page.locator('input[placeholder]').first().fill('e2e run')
    await page.getByRole('button', { name: 'Run simulation' }).click()

    await expect(page.getByRole('heading', { name: 'e2e run' })).toBeVisible({ timeout: 9 * 60 * 1000 })
    await expect(page.getByText('Convergence')).toBeVisible()
    await expect(page.locator('.recharts-line-curve').first()).toBeVisible()

    // The bug this guards: results are too large for localStorage and live in
    // IndexedDB, so a hard navigation used to lose them and break Compare.
    await page.goto('/')
    await page.getByRole('button', { name: /^6\s*Results$/ }).click()
    await expect(page.getByRole('heading', { name: 'e2e run' })).toBeVisible({ timeout: 60_000 })
  })

  test('the oracle baseline scores exactly 1.0', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-field=players] input').fill('16')
    await page.locator('[data-field=rounds] input').fill('3')

    await page.getByRole('button', { name: /^4\s*Ranking$/ }).click()
    await page.locator('.cm-content').first().waitFor()
    await page.locator('select').first().selectOption({ label: 'oracle' })

    await page.getByRole('button', { name: /^5\s*Run$/ }).click()
    await page.locator('[data-field=replications] input').fill('10')
    await page.locator('input[placeholder]').first().fill('oracle ceiling')
    await page.getByRole('button', { name: 'Run simulation' }).click()

    await expect(page.getByRole('heading', { name: 'oracle ceiling' })).toBeVisible({
      timeout: 9 * 60 * 1000,
    })
    await expect(page.locator('div.card', { hasText: 'KENDALL' }).first()).toContainText('1.0000')
  })
})

test.describe('the other pages', () => {
  test('the library lists real python from the builtins files', async ({ page }) => {
    await page.goto('/library')
    await expect(page.getByRole('heading', { name: 'Function library' })).toBeVisible()
    await page.getByRole('button', { name: 'Ranking', exact: true }).click()
    await page.getByText('matchup_adjusted').click()
    await expect(page.locator('pre')).toContainText('def rank_players')
  })

  test('the fit page turns a results table into settings', async ({ page }) => {
    await page.goto('/fit')
    await page.getByRole('button', { name: 'Use a sample' }).click()
    await expect(page.getByText('Games read')).toBeVisible()
    await expect(page.getByText('par_score')).toBeVisible()
    await page.getByRole('button', { name: 'Apply to my setup' }).click()
    await expect(page.getByText('Applied.')).toBeVisible()
  })

  test('the fit page explains an unreadable table instead of failing', async ({ page }) => {
    await page.goto('/fit')
    await page.locator('textarea').fill('who,whom,what\nAda,Bram,84')
    await expect(page.getByText(/Could not find the columns/)).toBeVisible()
  })

  test('the sweep page builds a set of configurations to run', async ({ page }) => {
    await page.goto('/sweep')
    await expect(page.getByRole('heading', { name: 'Sweep' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Run \d+ configurations/ })).toBeEnabled()
  })

  test('compare explains itself when there is nothing loaded', async ({ page }) => {
    await page.goto('/compare')
    await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible()
  })
})

test.describe('presentation', () => {
  test('both themes resolve and nothing scrolls sideways', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.goto('/')
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(bg).toBe(colorScheme === 'dark' ? 'rgb(12, 10, 9)' : 'rgb(250, 250, 249)')
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
      expect(overflows, `${colorScheme} scrolls sideways`).toBe(false)
    }
  })

  test('is usable at a phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'The field' })).toBeVisible()
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflows).toBe(false)
  })

  test('keyboard focus is visible', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const el = document.activeElement
      return el ? getComputedStyle(el).outlineWidth : '0px'
    })
    expect(outline).not.toBe('0px')
  })
})
