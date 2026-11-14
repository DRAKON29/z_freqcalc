/**
 * E2E: интерференция C/I (роадмап 2.3) — включение источника помехи,
 * карточка «Помехи (C/I)» в результатах (движок P.452 или честный фоллбек
 * P.2001-lite — сервис в CI/локально без карт ITU N050/DN50), выключение.
 */
import { expect, test } from '@playwright/test'
// Медиана дефолтной трассы зависит от движка http-модели (роадмап 2.6):
// 183.4 — полная P.2001-6 (Py2001 + карты ITU, локально и на проде),
// 173.0 — P.2001-lite (CI без карт)
const MEDIAN_DB = /173\.0|183\.4 дБ/


test('помеха: включение → карточка C/I с вердиктом, выключение → карточка скрыта', async ({ page }) => {
  await page.goto('/')
  // Включить источник помехи в карточке «Трасса»
  await page.getByRole('checkbox', { name: 'Учитывать помеху' }).click()
  await expect(page.getByText('Источник помехи (C/I, P.452)').first()).toBeVisible()

  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText(MEDIAN_DB).first()).toBeVisible({ timeout: 20000 })

  // Карточка помех: движок P.452 или честный фоллбек
  await expect(page.getByText('Помехи (C/I, ITU-R P.452)').first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/Защитное отношение (выполнено|НЕ выполнено)/).first()).toBeVisible()
  await expect(page.getByText(/I\/N/).first()).toBeVisible()
  // Детали пути помехи: внутри — движок или предупреждение фоллбека
  await page.getByText('Детали пути помехи').first().click()
  await expect(page.getByText(/Источник помехи: \d+\.\d+, \d+\.\d+/).first()).toBeVisible()
  // Либо настоящий P.452 (карты установлены), либо фоллбек с предупреждением
  await expect(page.getByText(/P\.452 недоступен|P\.452-18 \(Py452/).first()).toBeVisible()

  // Выключить — после пересчёта карточки нет
  await page.getByRole('checkbox', { name: 'Учитывать помеху' }).click()
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText(MEDIAN_DB).first()).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Помехи (C/I, ITU-R P.452)')).toHaveCount(0)
})
