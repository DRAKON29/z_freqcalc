/**
 * Тесты DynamicsPanel: «от трассы», переключатель одна/несколько высот,
 * добавление/удаление высот, запуск расчёта динамики, сводка.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DynamicsPanel } from '../DynamicsPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore, seedResult } from './test-utils'
import { bearingDeg } from '@/lib/radio/coordinates'

beforeEach(() => resetStore())

function inputByLabel(re: RegExp | string): HTMLInputElement {
  const label = screen.getByText(re)
  const container = label.closest('div')!
  const input = container.querySelector('input')
  if (!input) throw new Error(`input not found for `)
  return input as HTMLInputElement
}

describe('параметры борта: заполнение «от трассы»', () => {
  it('кнопка «От трассы» заполняет азимуты и длительность, высота и скорость остаются ручными', async () => {
    const user = userEvent.setup()
    render(<DynamicsPanel />)
    const az = bearingDeg(useRadioStore.getState().pointA, useRadioStore.getState().pointB)
    await user.click(screen.getByRole('button', { name: /От трассы/ }))
    const dp = useRadioStore.getState().dynamicsParams
    expect(dp.trajectoryAzimuthDeg).toBeCloseTo(Math.round(az * 10) / 10, 1)
    expect(dp.initialAzimuthDeg).toBeCloseTo(Math.round(az * 10) / 10, 1)
    expect(dp.initialElevationDeg).toBe(90)
    expect(dp.durationS).toBeGreaterThan(0)
    // Ручные параметры не перезаписаны
    expect(dp.altitudeM).toBe(500)
    expect(dp.speedKmh).toBe(150)
  })
  it('подсказка описывает, что остаётся ручным вводом', () => {
    render(<DynamicsPanel />)
    expect(screen.getByText(/Вручную остаются только/)).toBeInTheDocument()
    expect(screen.getAllByText(/высота полёта/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/путевая скорость/).length).toBeGreaterThanOrEqual(1)
  })
})

describe('режим высот: одна / несколько', () => {
  it('по умолчанию одна высота: поле «Высота полёта, м»', () => {
    render(<DynamicsPanel />)
    expect(inputByLabel('Высота полёта, м')).toHaveValue(500)
    expect(screen.queryByText(/Высоты полёта, м/)).not.toBeInTheDocument()
  })
  it('переключатель включает многовысотный режим со списком высот', async () => {
    const user = userEvent.setup()
    render(<DynamicsPanel />)
    await user.click(screen.getByLabelText('Переключатель режима высот'))
    expect(useRadioStore.getState().altitudeMode).toBe('multi')
    expect(screen.getByText(/Высоты полёта, м \(добавляйте кнопкой «\+»\)/)).toBeInTheDocument()
    expect(screen.getByText('2 высот')).toBeInTheDocument()
    expect(screen.getByLabelText('Добавить высоту')).toBeInTheDocument()
  })
  it('кнопка «Добавить» увеличивает список высот (+500 к последней)', async () => {
    const user = userEvent.setup()
    render(<DynamicsPanel />)
    await user.click(screen.getByLabelText('Переключатель режима высот'))
    await user.click(screen.getByLabelText('Добавить высоту'))
    expect(useRadioStore.getState().altitudes).toEqual([500, 1000, 1500])
  })
  it('удаление высоты крестиком убирает её из списка', async () => {
    const user = userEvent.setup()
    render(<DynamicsPanel />)
    await user.click(screen.getByLabelText('Переключатель режима высот'))
    await user.click(screen.getByLabelText('Убрать высоту 1000'))
    expect(useRadioStore.getState().altitudes).toEqual([500])
  })
  it('редактирование высоты в списке меняет altitudes', async () => {
    const user = userEvent.setup()
    render(<DynamicsPanel />)
    await user.click(screen.getByLabelText('Переключатель режима высот'))
    const firstAltitude = screen.getAllByDisplayValue('500')[0]
    fireEvent.change(firstAltitude, { target: { value: '700' } })
    expect(useRadioStore.getState().altitudes[0]).toBe(700)
  })
  it('в многовысотном режиме скорость и длительность редактируются', async () => {
    const user = userEvent.setup()
    render(<DynamicsPanel />)
    await user.click(screen.getByLabelText('Переключатель режима высот'))
    fireEvent.change(inputByLabel(/Путевая скорость, км\/ч \(100–200\)/), { target: { value: '180' } })
    expect(useRadioStore.getState().dynamicsParams.speedKmh).toBe(180)
  })
})

describe('запуск расчёта динамики', () => {
  it('кнопка заблокирована без результата расчёта', () => {
    render(<DynamicsPanel />)
    expect(screen.getByRole('button', { name: /Рассчитать динамику/ })).toBeDisabled()
    expect(screen.getByText(/Сначала выполните расчёт/)).toBeInTheDocument()
  })
  it('после расчёта кнопка активна и заполняет сводку', async () => {
    seedResult()
    render(<DynamicsPanel />)
    const btn = screen.getByRole('button', { name: /Рассчитать динамику/ })
    expect(btn).toBeEnabled()
    await userEvent.click(btn)
    await vi.waitFor(() => expect(useRadioStore.getState().dynamics).not.toBeNull())
    expect(screen.getByText(/Макс. доплер \(Doppler\)/)).toBeInTheDocument()
    expect(screen.getByText(/Мин. запас \(link margin\)/)).toBeInTheDocument()
    expect(screen.getByText('Выход из зоны связи')).toBeInTheDocument()
  })
  it('многовысотный расчёт показывает таблицу по высотам', async () => {
    seedResult()
    useRadioStore.setState({ altitudeMode: 'multi', altitudes: [500, 1000] })
    render(<DynamicsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Рассчитать динамику/ }))
    await vi.waitFor(() => expect(useRadioStore.getState().dynamicsAll).toHaveLength(2))
    expect(screen.getByText('Результаты по высотам')).toBeInTheDocument()
    expect(screen.getByText('Высота, м')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('1000')).toBeInTheDocument()
  })
  it('ошибка расчёта отображается в панели', () => {
    useRadioStore.setState({ lastError: 'Что-то сломалось' })
    render(<DynamicsPanel />)
    expect(screen.getByText('Что-то сломалось')).toBeInTheDocument()
  })
})
