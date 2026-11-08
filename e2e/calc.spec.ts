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

test('availability-отчёт P.530: карточка, прогноз недоступности, цели доступности', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

  // Карточка availability-отчёта
  await expect(page.getByText('Доступность связи (ITU-R P.530)').first()).toBeVisible({ timeout: 10000 })
  // Прогноз недоступности в ч/год или мин/год
  await expect(page.getByText(/ч\/год|мин\/год/).first()).toBeVisible()
  // Таблица целей: 99.5 / 99.9 / 99.99 %
  await expect(page.getByText('99.99 %')).toBeVisible()
  // Источник R(0.01 %) по умолчанию — оценка по зоне дождя (P.837-3)
  await expect(page.getByText(/оценка по зоне дождя/).first()).toBeVisible()
  // Строка прогноза недоступности в расходе бюджета
  await expect(page.getByText('Прогноз недоступности (P.530)').first()).toBeVisible()
})

test('clearance-аудит: блок просвета 0.6·F1 и класс трассы', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

  // Блок аудита в карточке профиля: вердикты по K = 4/3, 2/3, ∞
  await expect(page.getByText('Аудит просвета (0.6·F1):').first()).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('K = 4/3').first()).toBeVisible()
  await expect(page.getByText('K = 2/3').first()).toBeVisible()
  await expect(page.getByText('K = ∞').first()).toBeVisible()
  // Класс трассы (в аудите профиля и бейдж на карте)
  await expect(page.getByText(/(лёгкая|тяжёлая) трасса/).first()).toBeVisible()
})

test('шумовое окружение P.372: селектор в приёмнике и подсказка Fa', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Шумовое окружение (P.372)').first()).toBeVisible()
  // По умолчанию — не учитывать (контрольные значения прежние)
  await expect(page.getByText('Не учитывать (kTB + NF)').first()).toBeVisible()

  // Выбрать «Город / бизнес»: на 2400 МГц фит ниже теплового фона → Fa = 0
  await page.getByText('Не учитывать (kTB + NF)').first().click()
  await page.getByRole('option', { name: 'Город / бизнес' }).click()
  await expect(page.getByText(/фит P\.372 ниже теплового фона|Fa ≈/).first()).toBeVisible({ timeout: 10000 })
})

test('сравнение методов дифракции: раскрывающаяся таблица при затенении', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

  // На синтетическом DEM трасса затенена — сводка методов видна в свёрнутом виде
  const summary = page.getByText(/Сравнение методов дифракции/).first()
  await expect(summary).toBeVisible({ timeout: 10000 })
  await summary.click()
  await expect(page.getByText('Эпштейн–Петерсон (§4.5.1) — последовательные рёбра').first()).toBeVisible()
  await expect(page.getByText(/В расчёте: max\(Дейгаут, Буллингтон\)/).first()).toBeVisible()
})

test('поиск позиции A: чекбокс → радиус → блок с СК-42 по 7 цифр', async ({ page }) => {
  await page.goto('/')

  // Чекбокс скрытое поле радиуса: до включения поля нет
  await expect(page.getByLabel('Радиус поиска, м')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Поиск позиции' }).click()
  await expect(page.getByLabel('Радиус поиска, м')).toBeVisible()
  await page.getByLabel('Радиус поиска, м').fill('1000')

  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()

  // Свёрнутый блок: «найдено N оптимальных точек»
  const summary = page.getByText(/Поиск позиции A: найдено \d+ оптимальных точек/).first()
  await expect(summary).toBeVisible({ timeout: 40000 })
  await summary.click()
  await expect(page.getByText('Исходная точка A').first()).toBeVisible()
  // Координаты СК-42 — ровно 7 цифр на координату
  await expect(page.getByText(/^\d{7}$/).first()).toBeVisible()
  await expect(page.getByText(/Перебор по кольцам/).first()).toBeVisible()

  // Основная круговая диаграмма без слоя карты
  await expect(page.getByText('карта (спутник + населённые пункты)')).toHaveCount(0)

  // Если есть кандидаты: предпросмотр диаграммы при наведении + применение
  const firstCandidate = page.getByText('Кандидат 1', { exact: true }).first()
  const hasCandidates = await firstCandidate.isVisible().catch(() => false)
  if (hasCandidates) {
    // Пиктограмма круговой диаграммы: наведение — предпросмотр покрытия от позиции кандидата
    const diagramBtn = page.getByRole('button', { name: 'Диаграмма позиции 1', exact: true })
    await expect(diagramBtn).toBeVisible()
    await diagramBtn.hover()
    const preview = page.locator('canvas[aria-label="Круговая диаграмма радиосигнала с учётом рельефа"]').last()
    await expect(preview).toBeVisible({ timeout: 30000 })

    // «Применить»: точка A переносится в позицию кандидата 1, расчёт перезапускается
    const candRow = page.getByRole('row', { name: /Кандидат 1(?!\d)/ })
    const candText = (await candRow.textContent()) ?? ''
    // ячейки текстом слипаются: «Кандидат 1» + X (7 цифр) + Y — якорим на метку
    const candX = candText.match(/Кандидат 1\D*?(\d{7})/)?.[1]
    expect(candX).toBeDefined()
    await candRow.getByRole('button', { name: 'Применить позицию 1', exact: true }).click()
    const newSummary = page.getByText(/Поиск позиции A: найдено \d+ оптимальных точек/).first()
    await expect(newSummary).toBeVisible({ timeout: 60000 })
    // После пересчёта блок схлопнут — раскрываем снова
    await newSummary.click()
    // Новая исходная точка A = прежний кандидат 1 (та же координата X)
    const newRow = page.getByRole('row', { name: /Исходная точка A/ })
    await expect(newRow).toBeVisible({ timeout: 30000 })
    const newText = (await newRow.textContent()) ?? ''
    expect(newText).toContain(candX!)
  }
})
