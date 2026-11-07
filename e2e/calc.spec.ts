/** E2E: основной расчёт на дефолтной трассе — контрольные значения бюджета. */
import { expect, test } from '@playwright/test'

test('расчёт по умолчанию даёт контрольные значения (Москва, 2400 МГц, P.2001)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Калькулятор распространения радиоволн/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Рассчитать', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()

  // Медианные потери и бюджет: контрольные значения включают потери наведения 2×1.3 дБ (луч 30°)
  // (число может дублироваться в таблице бюджета — берём первое вхождение)
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })
  await expect(page.getByText(/-132\.7 дБм|−132\.7 дБм/).first()).toBeVisible()
  await expect(page.getByText(/-31\.3 дБ|−31\.3 дБ/).first()).toBeVisible()
  // Статус связи (трёхцветная индикация)
  await expect(page.getByText(/Связь (стабильна|нестабильна|отсутствует)/).first()).toBeVisible()
})

test('обратная линия присутствует в результатах', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })
  await expect(page.getByText(/Обратная линия/).first()).toBeVisible()
})
