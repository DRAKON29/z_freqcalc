/** E2E: история расчётов — новая запись появляется после расчёта. */
import { expect, test } from '@playwright/test'
// Медиана дефолтной трассы зависит от движка http-модели (роадмап 2.6):
// 183.4 — полная P.2001-6 (Py2001 + карты ITU, локально и на проде),
// 173.0 — P.2001-lite (CI без карт)
const MEDIAN_DB = /173\.0|183\.4 дБ/


test('после расчёта запись появляется в истории', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText(MEDIAN_DB).first()).toBeVisible({ timeout: 20000 })

  await page.getByRole('tab', { name: 'История' }).click()
  // Имя записи: «<дистанция> км @ <частота> МГц» (дефолт ~16.8 км @ 2400 МГц)
  await expect(page.getByText(/км @ 2400 МГц/).first()).toBeVisible({ timeout: 15000 })
})
