/**
 * E2E: UX-пакет (этап UX, референс antenna.2tg.dev) —
 * share-ссылка, пользовательские пресеты оборудования, режимы преград
 * кругового покрытия, полноэкранный режим карты.
 */
import { expect, test } from '@playwright/test'

test('share-ссылка: кнопка копирует URL и показывает toast', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])
  await page.goto('/')
  await page.getByRole('button', { name: /Поделиться/ }).click()
  await expect(page.getByText('Ссылка скопирована').first()).toBeVisible()
})

test('share-ссылка: открытие ссылки с hash применяет ввод и запускает расчёт (run=1)', async ({ page }) => {
  await page.goto('/#a=55.755800,37.617300&b=55.830500,37.850100&f=5800&fm=s&md=p2001&run=1')
  // Частота из ссылки применена к форме (поле «Частота передатчика, МГц»)
  const freqInput = page.locator('div:has(> label:has-text("Частота передатчика")) input[type="number"]')
  await expect(freqInput.first()).toHaveValue('5800', { timeout: 15000 })
  // Автозапуск: расчёт отработал и вернул кнопку в исходное состояние
  await expect(page.getByRole('button', { name: 'Рассчитать', exact: true })).toBeEnabled({ timeout: 30000 })
})

test('пресеты: сохранение из карточки станции и применение', async ({ page }) => {
  await page.goto('/')
  // Сохранить пресет из карточки наземной станции
  await page.getByRole('button', { name: /Сохранить пресет как…/ }).first().click()
  await expect(page.getByText('Введите имя пресета')).toBeVisible()
  await page.getByRole('textbox', { name: 'Введите имя пресета' }).fill('Тест-пресет E2E')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText(/Пресет сохранён/).first()).toBeVisible()
  // Пресет появился в селекторе применения
  const applyTrigger = page.getByLabel('Применить сохранённый пресет').first()
  await expect(applyTrigger).toBeVisible()
  await applyTrigger.click()
  await page.getByRole('option', { name: /Тест-пресет E2E/ }).first().click()
  await expect(page.getByText(/Пресет применён/).first()).toBeVisible()
})

test('пресеты: вкладка «Карты и настройки» — импорт с перезаписью и красным предупреждением', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: /Карты и настройки/ }).click()
  // Секция свёрнута по умолчанию — раскрыть
  await page.getByText('Пресеты оборудования').first().click()
  await expect(page.getByText(/Режим импорта/)).toBeVisible()

  // Режим «переписать» → красное предупреждение
  await page.getByRole('radio', { name: /переписать существующие/ }).check()
  await expect(page.getByText(/перезаписаны безвозвратно/)).toBeVisible()

  // Импорт корректного файла в режиме «добавить»
  await page.getByRole('radio', { name: /добавить к существующим/ }).check()
  const fileJson = JSON.stringify({
    version: 1,
    presets: [
      {
        id: 'e2e-1',
        name: 'Импортный пресет',
        station: 'mobile',
        createdAt: '2026-11-14T10:00:00.000Z',
        antenna: { gainDbi: 3, polarization: 'vertical' },
        radio: { powerDbm: 20, sensitivityDbm: -100 },
      },
    ],
  })
  const presetsInput = page.locator('label:has-text("Импорт из файла") input[type=file]')
  await presetsInput.setInputFiles([{ name: 'presets.json', mimeType: 'application/json', buffer: Buffer.from(fileJson) }])
  await expect(page.getByText(/Добавлено пресетов: 1/).first()).toBeVisible()
  await expect(page.getByText('Импортный пресет').first()).toBeVisible()
})

test('режимы преград: селектор переключается, легенда адаптируется', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })

  const modeTrigger = page.getByLabel('Преграды на покрытии')
  await expect(modeTrigger).toBeVisible({ timeout: 15000 })
  await modeTrigger.click()
  await page.getByRole('option', { name: /Геометрия LOS/ }).click()
  // Легенда и подпись карточек перешли на геометрию
  await expect(page.getByText('зона видимости (LOS)').first()).toBeVisible()
  await expect(page.getByText('Граница видимости (LOS)').first()).toBeVisible()
  // Подсказка режима — честное описание худшего случая
  await expect(page.getByText(/худший случай/).first()).toBeVisible()
})

test('fullscreen карты: разворот, клик по кнопке внутри карты, сворачивание', async ({ page }) => {
  await page.goto('/')
  // Кнопка теперь внутри контейнера карты — доступна и после разворота
  await page.getByRole('button', { name: /Во весь экран/ }).click()
  // Контейнер перешёл в полноэкранный режим (data-атрибут + размеры вьюпорта)
  const fsContainer = page.locator('div[data-fullscreen="true"]')
  await expect(fsContainer).toBeVisible()
  const box = await fsContainer.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThan(600) // полноэкранный, а не 380px
  // Кнопка «Свернуть» внутри полноэкранной карты кликабельна (регресс:
  // раньше внешняя кнопка уходила под слой карты)
  // Скролл страницы под оверлеем заблокирован для пользователя (колесо мыши
  // при html overflow:hidden не скроллит), после выхода — позиция восстановлена
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(300)
  const yLocked = await page.evaluate(() => Math.round(window.scrollY))
  expect(yLocked).toBe(0)
  await page.getByRole('button', { name: /Свернуть/ }).click()
  await expect(fsContainer).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Во весь экран/ })).toBeVisible()
  // Шапка приложения видна после сворачивания (регресс: «пропадает вся шапка»)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator('header')).toBeVisible()
})

test('покрытие на карте: автопоказ оверлея, тумблер, бейдж статистики (этап 2.5)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click()
  await expect(page.getByText('173.0 дБ').first()).toBeVisible({ timeout: 20000 })
  // автопоказ: геопривязанный канва-оверлей появился на карте
  const overlay = page.locator('img.leaflet-image-layer.coverage-overlay-layer')
  await expect(overlay).toBeVisible({ timeout: 15000 })
  // бейдж статистики покрытия в тулбаре карты
  await expect(page.getByText(/покрыто \d+ % · макс/).first()).toBeVisible()
  // тумблер скрывает и возвращает слой
  await page.getByRole('button', { name: /Покрытие на карте/ }).click()
  await expect(overlay).toHaveCount(0)
  await page.getByRole('button', { name: /Покрытие на карте/ }).click()
  await expect(overlay).toBeVisible()
})
