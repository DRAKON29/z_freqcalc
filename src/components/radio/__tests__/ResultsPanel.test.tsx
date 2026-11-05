/**
 * Тесты ResultsPanel: пустое состояние, сводка, бюджет, предупреждения,
 * диапазон частот, экспорт JSON/CSV.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultsPanel } from '../ResultsPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore, seedResult, fakeResult } from './test-utils'
import { makeInput } from '../../../lib/radio/__tests__/fixtures'

vi.mock('@/lib/radio/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/radio/export')>()
  return { ...actual, download: vi.fn() }
})

beforeEach(() => resetStore())

describe('пустое состояние', () => {
  it('без расчёта показывается приглашение', () => {
    render(<ResultsPanel />)
    expect(screen.getByText(/Выполните расчёт — здесь появятся бюджет линии/)).toBeInTheDocument()
  })
})

describe('результаты после расчёта', () => {
  it('сводка: медианные потери, P_rx, SNR, запас', () => {
    seedResult()
    render(<ResultsPanel />)
    expect(screen.getByText('Медианные потери')).toBeInTheDocument()
    expect(screen.getByText('Отношение сигнал/шум (SNR)')).toBeInTheDocument()
    expect(screen.getByText('Запас на линию (link margin)')).toBeInTheDocument()
    // значения из seed
    expect(screen.getByText('-85.0').parentElement!.textContent).toContain('дБм')
  })
  it('таблицы бюджета: приход и расход', () => {
    seedResult()
    render(<ResultsPanel />)
    expect(screen.getByText('Бюджет линии (Link Budget)')).toBeInTheDocument()
    expect(screen.getByText('Приход')).toBeInTheDocument()
    expect(screen.getByText('Расход')).toBeInTheDocument()
    expect(screen.getByText('Мощность передатчика (P_tx)')).toBeInTheDocument()
    expect(screen.getByText('ЭИИМ (EIRP)')).toBeInTheDocument()
    expect(screen.getByText('Link margin')).toBeInTheDocument()
  })
  it('отрицательный запас → предупреждение о необеспеченной связи', () => {
    const { result, budget, lastInput } = fakeResult()
    useRadioStore.setState({ result, lastInput, budget: { ...budget, linkMarginDb: -3.4, snrDb: 6.2 } })
    render(<ResultsPanel />)
    expect(screen.getByText(/линия связи не обеспечивается/)).toBeInTheDocument()
  })
  it('предупреждения fallback модели выводятся списком', () => {
    const { result, budget, lastInput } = fakeResult()
    useRadioStore.setState({
      result: { ...result, warnings: ['Python-сервис недоступен — выполнен локальный расчёт'] },
      budget,
      lastInput,
    })
    render(<ResultsPanel />)
    expect(screen.getByText(/Python-сервис недоступен/)).toBeInTheDocument()
  })
  it('предупреждение о покрытии рельефа выводится', () => {
    seedResult()
    useRadioStore.setState({ terrainWarning: 'Часть трассы (30% точек профиля) выходит за пределы загруженных тайлов рельефа' })
    render(<ResultsPanel />)
    expect(screen.getByText(/выходит за пределы загруженных тайлов/)).toBeInTheDocument()
  })
  it('профиль трассы: график с основными линиями', () => {
    seedResult()
    render(<ResultsPanel />)
    expect(screen.getByText(/Профиль трассы: рельеф, прямая видимость, зона Френеля, препятствия/)).toBeInTheDocument()
    expect(screen.getByText(/с учётом кривизны Земли/)).toBeInTheDocument()
  })
})

describe('режим диапазона частот', () => {
  it('таблица и график по диапазону', () => {
    seedResult()
    useRadioStore.setState({
      rangeResults: [
        { frequencyMhz: 1000, medianLossDb: 120, linkMarginDb: 20, prxDbm: -80, snrDb: 30 },
        { frequencyMhz: 1005.5, medianLossDb: 121, linkMarginDb: 18, prxDbm: -81, snrDb: 28 },
        { frequencyMhz: 1011, medianLossDb: 122, linkMarginDb: 16, prxDbm: -82, snrDb: 26 },
      ],
    })
    render(<ResultsPanel />)
    expect(screen.getByText('Диапазон частот: 1000.0–1011.0 МГц')).toBeInTheDocument()
    expect(screen.getByText('Частота, МГц')).toBeInTheDocument()
    expect(screen.getAllByText('1005.5').length).toBeGreaterThanOrEqual(1)
  })
})

describe('экспорт', () => {
  it('кнопки JSON/CSV/Печать присутствуют', () => {
    seedResult()
    render(<ResultsPanel />)
    expect(screen.getByRole('button', { name: /Экспорт JSON/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Экспорт CSV/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Печать/ })).toBeInTheDocument()
  })
  it('экспорт JSON вызывает download() с payload', async () => {
    seedResult()
    render(<ResultsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Экспорт JSON/ }))
    const { download } = await import('@/lib/radio/export')
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/расчёт-.*\.json/), expect.stringContaining('frequencyMhz'), 'application/json')
  })
  it('экспорт CSV вызывает download() с csv-строкой', async () => {
    seedResult()
    render(<ResultsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Экспорт CSV/ }))
    const { download } = await import('@/lib/radio/export')
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/\.csv/), expect.stringContaining('Секция;Параметр;Значение'), 'text/csv')
  })
  it('в payload попадает частота из lastInput', async () => {
    seedResult()
    render(<ResultsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Экспорт JSON/ }))
    const { download } = await import('@/lib/radio/export')
    const json = vi.mocked(download).mock.calls[0][1] as string
    expect(JSON.parse(json).input.frequencyMhz).toBe(makeInput({ frequencyMhz: 2400 }).frequencyMhz)
  })
})
