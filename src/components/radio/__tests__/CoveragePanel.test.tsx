/**
 * Тесты CoveragePanel: построение после расчёта, автоматический радиус,
 * статистика, перестроение, предупреждение о тайлах.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoveragePanel } from '../CoveragePanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore, seedResult } from './test-utils'
import { computeCoverage, sampleElevationGrid } from '@/lib/radio/coverage'
import type { CoverageResult, ElevationGrid } from '@/lib/radio/coverage'

vi.mock('@/lib/radio/coverage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/radio/coverage')>()
  const radials = Array.from({ length: 72 }, (_, i) => ({
    azDeg: i * 5,
    maxKm: 40 + (i % 4),
    marginAtMaxDb: 5.5,
    strongKm: 25 + (i % 3),
  }))
  const fakeCoverage: CoverageResult = {
    radiusKm: 40,
    azimuthStepDeg: 5,
    radials,
    stats: {
      coveredAzimuthPercent: 100,
      areaPercent: 64.2,
      minKm: 40,
      medianKm: 41.5,
      maxKm: 43,
      strongMinKm: 25,
      strongMaxKm: 27,
    },
    frequencyMhz: 2400,
    routeKm: 30,
    routeAzDeg: 65,
    engineUsed: 'TS: test engine',
    computedAtMs: 12,
  }
  const fakeGrid: ElevationGrid = {
    n: 2,
    halfM: 1000,
    data: new Float32Array([0, 100, 200, 300]),
    minElev: 0,
    maxElev: 300,
    nodataZero: false,
  }
  return {
    ...actual,
    computeCoverage: vi.fn().mockReturnValue(fakeCoverage),
    sampleElevationGrid: vi.fn().mockReturnValue(fakeGrid),
  }
})

const mockCompute = vi.mocked(computeCoverage)
const mockGrid = vi.mocked(sampleElevationGrid)

beforeEach(() => {
  resetStore()
  seedResult() // трасса 30 км → авто-радиус 40 км
  mockCompute.mockClear()
  mockGrid.mockClear()
})

describe('появление панели', () => {
  it('панель не отображается без расчёта', () => {
    resetStore()
    render(<CoveragePanel />)
    expect(screen.queryByText(/Круговая диаграмма радиосигнала/)).not.toBeInTheDocument()
  })

  it('после расчёта строится диаграмма с автоматическим радиусом (трасса + 10 км)', async () => {
    render(<CoveragePanel />)
    expect(screen.getByText(/Круговая диаграмма радиосигнала \(polar coverage\)/)).toBeInTheDocument()
    await waitFor(() => {
      expect(mockCompute).toHaveBeenCalledTimes(1)
    })
    expect(mockCompute.mock.calls[0][0].radiusKm).toBe(40)
    // подпись автоматического значения в селекте
    expect(screen.getByText(/Длина трассы \+ 10 км \(40\.0 км\)/)).toBeInTheDocument()
    // канва диаграммы на месте
    expect(document.querySelector('canvas')).not.toBeNull()
  })

  it('статистика: граница связи, уверенный приём, сектор, площадь', async () => {
    render(<CoveragePanel />)
    await waitFor(() => {
      expect(screen.getByText('Граница связи (запас ≥ 0 дБ)')).toBeInTheDocument()
    })
    expect(screen.getByText('40.0–43.0 км')).toBeInTheDocument()
    expect(screen.getByText('Уверенный приём (запас ≥ 10 дБ)')).toBeInTheDocument()
    expect(screen.getByText('100 % азимутов')).toBeInTheDocument()
    expect(screen.getByText('64 % круга')).toBeInTheDocument()
    expect(screen.getByText(/медиана 41\.5 км/)).toBeInTheDocument()
  })

  it('легенда и подпись движка присутствуют', async () => {
    render(<CoveragePanel />)
    await waitFor(() => {
      expect(screen.getByText(/зона связи \(запас ≥ 0 дБ\)/)).toBeInTheDocument()
    })
    expect(screen.getByText(/трасса A→Б/)).toBeInTheDocument()
    expect(screen.getByText(/Азимут 0° — север/)).toBeInTheDocument()
    expect(screen.getByText(/азимутов: 72 \(шаг 5°\)/)).toBeInTheDocument()
  })
})

describe('перестроение и радиус', () => {
  it('кнопка «Построить заново» вызывает повторный расчёт', async () => {
    render(<CoveragePanel />)
    await waitFor(() => {
      expect(mockCompute).toHaveBeenCalledTimes(1)
    })
    await userEvent.click(screen.getByRole('button', { name: /Построить заново/ }))
    await waitFor(() => {
      expect(mockCompute).toHaveBeenCalledTimes(2)
    })
  })

  it('выбор фиксированного радиуса передаётся в расчёт', async () => {
    render(<CoveragePanel />)
    await waitFor(() => {
      expect(mockCompute).toHaveBeenCalledTimes(1)
    })
    // переключаем значение радиуса напрямую через store-независимый UI:
    // открываем селект и выбираем 15 км
    const trigger = screen.getByRole('combobox', { name: /Радиус расчёта \(radius\)/ })
    await userEvent.click(trigger)
    const option = await screen.findByRole('option', { name: '15 км' })
    await userEvent.click(option)
    await waitFor(() => {
      expect(mockCompute).toHaveBeenCalledTimes(2)
    })
    expect(mockCompute.mock.calls[1][0].radiusKm).toBe(15)
  })

  it('бейдж показывает текущую частоту и радиус', async () => {
    render(<CoveragePanel />)
    await waitFor(() => {
      expect(screen.getByText(/2400 МГц · радиус 40\.0 км/)).toBeInTheDocument()
    })
  })
})
