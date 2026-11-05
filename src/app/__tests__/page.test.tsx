/**
 * Тесты главной страницы (page.tsx): шапка, вкладки, панель расчёта,
 * вызов checkBackend, кнопка «Рассчитать».
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Home from '@/app/page'
import { useRadioStore } from '@/store/radio-store'
import { resetStore } from '../../components/radio/__tests__/test-utils'

// Leaflet-карта мокается (в page она подключена через next/dynamic)
vi.mock('@/components/radio/MapPanel', () => ({
  MapPanel: () => <div data-testid="map-panel-mock" />,
}))
vi.mock('leaflet', () => {
  const leaflet = {
    map: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn(), on: vi.fn(), setView: vi.fn().mockReturnThis() })),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    layerGroup: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn() })),
    latLng: vi.fn(),
    latLngBounds: vi.fn(() => ({ extend: vi.fn().mockReturnThis(), pad: vi.fn().mockReturnThis() })),
    rectangle: vi.fn(() => ({ bindTooltip: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis() })),
    polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    divIcon: vi.fn(),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
  }
  return { default: leaflet, ...leaflet }
})

beforeEach(async () => {
  resetStore()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('backend down')))
  // IndexedDB (fake-indexeddb) живёт в воркере между файлами — чистим историю,
  // чтобы тест «пустая история» был детерминированным
  const { clearHistory, getDeviceId } = await import('@/lib/radio/history')
  await clearHistory(getDeviceId())
})

describe('главная страница', () => {
  it('шапка с названием калькулятора и диапазоном частот', async () => {
    render(<Home />)
    expect(screen.getByText('Калькулятор распространения радиоволн')).toBeInTheDocument()
    expect(screen.getByText(/500–7000 МГц/)).toBeInTheDocument()
  })
  it('четыре вкладки: Расчёт, Динамика, История, Карты и настройки', () => {
    render(<Home />)
    expect(screen.getByRole('tab', { name: /Расчёт/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Динамика/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /История/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Карты и настройки/ })).toBeInTheDocument()
  })
  it('на вкладке расчёта — карта (мок), ввод и оборудование', () => {
    render(<Home />)
    expect(screen.getByTestId('map-panel-mock')).toBeInTheDocument()
    expect(screen.getByText('Точка A (передатчик)')).toBeInTheDocument()
    expect(screen.getByText('Модель и бэкенд расчёта')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Рассчитать' })).toBeEnabled()
  })
  it('checkBackend вызывается при монтировании и ставит бейдж недоступности (http-бэкенд)', async () => {
    useRadioStore.setState({ backend: 'http' })
    render(<Home />)
    await waitFor(() => expect(useRadioStore.getState().backendAvailable).toBe(false))
    await waitFor(() => expect(screen.getByText(/http · офлайн/)).toBeInTheDocument())
  })
  it('кнопка «Рассчитать» запускает расчёт и показывает результат (fallback локальной модели)', async () => {
    const user = userEvent.setup()
    // http-бэкенд недоступен → fallback на локальную модель, результат всё равно строится
    useRadioStore.setState({ backend: 'http' })
    render(<Home />)
    await user.click(screen.getByRole('button', { name: 'Рассчитать' }))
    await waitFor(() => expect(useRadioStore.getState().result).not.toBeNull(), { timeout: 5000 })
    await waitFor(() => expect(screen.getByText('Медианные потери')).toBeInTheDocument())
  })
  it('переключение на вкладку «Динамика» показывает панель борта', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await user.click(screen.getByRole('tab', { name: /Динамика/ }))
    expect(screen.getByText('Параметры борта')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /От трассы/ })).toBeInTheDocument()
  })
  it('вкладка «История» показывает пустую историю', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await user.click(screen.getByRole('tab', { name: /История/ }))
    await waitFor(() => expect(screen.getByText(/Расчётов пока нет/)).toBeInTheDocument())
  })
  it('вкладка «Карты и настройки» показывает рельеф и SXF/RSC', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await user.click(screen.getByRole('tab', { name: /Карты и настройки/ }))
    expect(screen.getByText(/Рельеф \(DEM\) — границы загруженных тайлов/)).toBeInTheDocument()
    expect(screen.getByText('Здания и растительность (SXF/RSC)')).toBeInTheDocument()
    expect(screen.getByText('Цифровые карты ITU (P.2001)')).toBeInTheDocument()
  })
  it('подвал содержит справку о моделях и СК-42', () => {
    render(<Home />)
    expect(screen.getByText(/ITU-R P\.2001\/P\.525\/P\.526/)).toBeInTheDocument()
    expect(screen.getByText(/СК-42 \(Гаусс–Крюгер\)/)).toBeInTheDocument()
  })
})
