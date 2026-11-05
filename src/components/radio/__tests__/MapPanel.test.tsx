/**
 * Тесты MapPanel: переключение типа карты (схема/спутник/гибрид),
 * режим клика (точка A/Б), границы тайлов рельефа. Leaflet мокается.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MapPanel } from '../MapPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore } from './test-utils'
import { makeHgtBuffer } from '../../../lib/radio/__tests__/terrain-helpers'

const tileLayerSpy = vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() }))

vi.mock('leaflet', () => {
  const leaflet = {
    map: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      on: vi.fn(),
      setView: vi.fn().mockReturnThis(),
      fitBounds: vi.fn(),
      removeLayer: vi.fn(),
    })),
    tileLayer: (...args: unknown[]) => tileLayerSpy(...(args as [])),
    layerGroup: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn() })),
    latLng: vi.fn(),
    latLngBounds: vi.fn(() => ({ extend: vi.fn().mockReturnThis(), pad: vi.fn().mockReturnThis() })),
    rectangle: vi.fn(() => ({ bindTooltip: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis() })),
    polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), getBounds: vi.fn(() => ({ extend: vi.fn().mockReturnThis() })) })),
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn(), setLatLng: vi.fn() })),
    divIcon: vi.fn(),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
  }
  return { default: leaflet, ...leaflet }
})

beforeEach(() => {
  resetStore()
  tileLayerSpy.mockClear()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('MapPanel: переключение типа карты', () => {
  it('кнопки «Схема», «Спутник», «Гибрид» присутствуют, по умолчанию схема', () => {
    render(<MapPanel />)
    expect(screen.getByRole('button', { name: 'Схема' })).toHaveClass(/default|bg-primary|data-\[state\]|text-primary-foreground/)
    expect(screen.getByRole('button', { name: 'Спутник' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Гибрид' })).toBeInTheDocument()
  })
  it('переключение на спутник меняет активную кнопку', async () => {
    render(<MapPanel />)
    await waitFor(() => expect(tileLayerSpy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Спутник' }))
    expect(tileLayerSpy).toHaveBeenCalledWith(
      expect.stringContaining('World_Imagery'),
      expect.objectContaining({ maxZoom: 19 }),
    )
  })
  it('гибрид добавляет слой подписей (overlay)', async () => {
    render(<MapPanel />)
    await waitFor(() => expect(tileLayerSpy).toHaveBeenCalled())
    const callsBefore = tileLayerSpy.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Гибрид' }))
    // базовый слой + слой подписей
    expect(tileLayerSpy.mock.calls.length).toBeGreaterThanOrEqual(callsBefore + 2)
    expect(tileLayerSpy).toHaveBeenCalledWith(
      expect.stringContaining('World_Boundaries_and_Places'),
      expect.anything(),
    )
  })
})

describe('MapPanel: выбор точек кликом', () => {
  it('кнопки «Клик → точка A» и «Клик → точка Б»', () => {
    render(<MapPanel />)
    expect(screen.getByRole('button', { name: 'Клик → точка A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Клик → точка Б' })).toBeInTheDocument()
  })
})

describe('MapPanel: границы тайлов рельефа', () => {
  it('кнопка видимости тайлов появляется при загруженных тайлах', () => {
    useRadioStore.getState().addHgtTile(makeHgtBuffer(1201, () => 50), 'N47E039.hgt')
    render(<MapPanel />)
    expect(screen.getByRole('button', { name: 'Границы тайлов рельефа' })).toBeInTheDocument()
  })
  it('подсказка под картой описывает поведение', () => {
    render(<MapPanel />)
    expect(screen.getByText(/Клик по карте ставит выбранную точку/)).toBeInTheDocument()
    expect(screen.getByText(/границы загруженных тайлов рельефа — бирюзовым пунктиром/)).toBeInTheDocument()
  })
})
