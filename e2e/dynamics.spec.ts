/** E2E: динамика (ручной режим) — расчёт по умолчанию после линии. */
import { expect, test } from '@playwright/test'

test('расчёт динамики в ручном режиме', async ({ page }) => {
  await page.goto('/')
  // Динамика требует выполненного расчёта линии
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

  await page.getByRole('tab', { name: 'Динамика' }).click()
  await expect(page.getByText('Параметры борта')).toBeVisible()
  await expect(page.getByRole('button', { name: 'От трассы' })).toBeVisible()

  await page.getByRole('button', { name: 'Рассчитать динамику' }).click()
  // Сводка: одна высота / 301 точка (durationS 300 → nSteps = 300, +1)
  await expect(page.getByText('Макс. доплер')).toBeVisible({ timeout: 20000 })
  await expect(page.getByText(/1 \/ 301/)).toBeVisible()
  // Графики отрисовались
  await expect(page.getByText('Углы и доплер (Doppler)')).toBeVisible()
  await expect(page.getByText('ОСШ (SNR) и запас (link margin)')).toBeVisible()
})

test('переключатель нескольких высот добавляет высоты', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Динамика' }).click()
  await page.getByRole('switch').click()
  await expect(page.getByText('Высоты полёта, м')).toBeVisible()
  // Дефолтные высоты 500 и 1000 — значения инпутов
  const heightInputs = page.locator('input[type="number"][min="5"][max="20000"]')
  await expect(heightInputs).toHaveCount(2)
  await expect(heightInputs.first()).toHaveValue('500')
  await expect(heightInputs.nth(1)).toHaveValue('1000')
})
