/** E2E: вкладка «Карты и настройки» — секции, статусы продуктов, рельеф. */
import { expect, test } from '@playwright/test'

test('секции вкладки «Карты» раскрываются, DEM без тайлов — синтетический рельеф', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: /Карты и настройки/ }).click()

  await expect(page.getByText('Рельеф (DEM) — границы загруженных тайлов')).toBeVisible()
  await expect(page.getByText('Цифровые карты ITU (P.2001)')).toBeVisible()
  await expect(page.getByText('Настройки и PWA')).toBeVisible()

  // Секция DEM: синтетический рельеф до загрузки тайлов
  await page.getByRole('button', { name: /Рельеф \(DEM\)/ }).click()
  await expect(page.getByText(/Синтетический рельеф \(demo\)/)).toBeVisible()
  // Кнопка автоподкачки тайлов трассы присутствует
  await expect(page.getByRole('button', { name: /Подтянуть тайлы трассы с сервера/ })).toBeVisible()
})

test('счётчик продуктов ITU (в чистой среде — 0 из 14)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: /Карты и настройки/ }).click()
  await page.getByRole('button', { name: /Цифровые карты ITU/ }).click()
  // В CI-среде кэш браузера пуст: 0 из 14; локально может быть больше — проверяем формат
  await expect(page.getByText(/ из 14/)).toBeVisible()
})
