/** E2E: динамика (ручной режим) — расчёт по умолчанию после линии. */
import { expect, test } from '@playwright/test'
// Медиана дефолтной трассы зависит от движка http-модели (роадмап 2.6):
// 183.4 — полная P.2001-6 (Py2001 + карты ITU, локально и на проде),
// 173.0 — P.2001-lite (CI без карт)
const MEDIAN_DB = /173\.0|183\.4 дБ/


test('расчёт динамики в ручном режиме', async ({ page }) => {
  await page.goto('/')
  // Динамика требует выполненного расчёта линии
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText(MEDIAN_DB).first()).toBeVisible({ timeout: 20000 })

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

test('динамика 2.2: рельеф per-sample, скорости 0–300, прогресс расчёта', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText(MEDIAN_DB).first()).toBeVisible({ timeout: 20000 })

  await page.getByRole('tab', { name: 'Динамика' }).click()
  // Подпись скорости из LIMITS (0–300), поле номинального угла места присутствует
  await expect(page.getByText(/Путевая скорость, км\/ч \(0–300\)/).first()).toBeVisible()
  await expect(page.getByLabel('Номинальный угол места антенн, °')).toBeVisible()
  // Сноска о рельефе per-sample
  await expect(page.getByText(/Потери считаются по профилю рельефа/).first()).toBeVisible()

  // Скорость 300 км/ч — расчёт проходит с прогрессом
  await page.getByLabel(/Путевая скорость/).first().fill('300')
  await page.getByRole('button', { name: 'Рассчитать динамику' }).click()
  await expect(page.getByText('Макс. доплер').first()).toBeVisible({ timeout: 60000 })
  await expect(page.getByText(/1 \/ 301/)).toBeVisible()
  await expect(page.getByText('ОСШ (SNR) и запас (link margin)')).toBeVisible()
})
