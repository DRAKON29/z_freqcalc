/** E2E: загрузка файла траектории (.rt) и расчёт динамики по маршруту. */
import { expect, test } from '@playwright/test'
// Медиана дефолтной трассы зависит от движка http-модели (роадмап 2.6):
// 183.4 — полная P.2001-6 (Py2001 + карты ITU, локально и на проде),
// 173.0 — P.2001-lite (CI без карт)
const MEDIAN_DB = /173\.0|183\.4 дБ/

import path from 'node:path'

const FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'route-sample.rt')

test('файл траектории: сводка маршрута и расчёт динамики по нему', async ({ page }) => {
  await page.goto('/')
  // Динамика требует выполненного расчёта линии
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText(MEDIAN_DB).first()).toBeVisible({ timeout: 20000 })

  await page.getByRole('tab', { name: 'Динамика' }).click()
  // Скрытый file-input: setInputFiles работает и на невидимых элементах
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE)

  // Сводка маршрута из образца
  await expect(page.getByText(/Маршрут: route-sample\.rt/)).toBeVisible()
  await expect(page.getByText(/Точек:\s*4/)).toBeVisible()
  await expect(page.getByText(/204–1063 м/)).toBeVisible()
  await expect(page.getByText(/120–130 км\/ч/)).toBeVisible()
  // Ручные поля скрыты
  await expect(page.getByRole('button', { name: 'От трассы' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Рассчитать динамику' }).click()
  await expect(page.getByText('Макс. доплер')).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('По маршруту').first()).toBeVisible()
})
