/** E2E: история расчётов — новая запись появляется после расчёта. */
import { expect, test } from '@playwright/test'

test('после расчёта запись появляется в истории', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

  await page.getByRole('tab', { name: 'История' }).click()
  // Имя записи: «<дистанция> км @ <частота> МГц» (дефолт ~16.8 км @ 2400 МГц)
  await expect(page.getByText(/км @ 2400 МГц/).first()).toBeVisible({ timeout: 15000 })
})
