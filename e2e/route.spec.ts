/** E2E: загрузка файла траектории (.rt) и расчёт динамики по маршруту. */
import { expect, test } from '@playwright/test'
import path from 'node:path'

const FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'route-sample.rt')

test('файл траектории: сводка маршрута и расчёт динамики по нему', async ({ page }) => {
  await page.goto('/')
  // Динамика требует выполненного расчёта линии
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

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
