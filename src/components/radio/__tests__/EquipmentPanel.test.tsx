/**
 * Тесты EquipmentPanel: модель/бэкенд, упрощённый и подробный режим,
 * мощность передатчика в дБм или мВт (переключатель единиц), модуляции.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EquipmentPanel } from '../EquipmentPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore } from './test-utils'

beforeEach(() => resetStore())

/** Поиск input по подписи. */
function inputByLabel(re: RegExp | string): HTMLInputElement {
  const label = screen.getByText(re)
  const container = label.closest('div')!
  const input = container.querySelector('input')
  if (!input) throw new Error(`input not found for `)
  return input as HTMLInputElement
}

describe('модель и бэкенд расчёта', () => {
  it('заголовок и индикатор бэкенда', () => {
    render(<EquipmentPanel />)
    expect(screen.getByText('Модель и бэкенд расчёта')).toBeInTheDocument()
    expect(screen.getByText(/бэкенд: wasm/)).toBeInTheDocument()
  })
  it('кнопка «проверить доступность» обращается к /health', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'))
    vi.stubGlobal('fetch', fetchMock)
    render(<EquipmentPanel />)
    await user.click(screen.getByText('проверить доступность'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/health'), expect.anything()))
    expect(useRadioStore.getState().backendAvailable).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('мощность передатчика: дБм ↔ мВт', () => {
  it('по умолчанию дБм: 30 дБм, подсказка ≈ 1000.00 мВт', () => {
    render(<EquipmentPanel />)
    expect(inputByLabel('Мощность, дБм (dBm)')).toHaveValue(30)
    expect(screen.getByText('≈ 1000.00 мВт (mW)')).toBeInTheDocument()
  })
  it('переключатель единиц показывает значение в мВт (30 дБм = 1000 мВт)', async () => {
    const user = userEvent.setup()
    render(<EquipmentPanel />)
    await user.click(screen.getByLabelText('Переключатель единиц мощности'))
    expect(inputByLabel('Мощность, мВт (mW)')).toHaveValue(1000)
    expect(screen.getByText('≈ 30.00 дБм (dBm)')).toBeInTheDocument()
  })
  it('ввод в мВт конвертируется в дБм в store (1000 мВт → 30 дБм)', async () => {
    const user = userEvent.setup()
    render(<EquipmentPanel />)
    await user.click(screen.getByLabelText('Переключатель единиц мощности'))
    fireEvent.change(inputByLabel('Мощность, мВт (mW)'), { target: { value: '500' } })
    const powerDbm = useRadioStore.getState().equipment.transmitter.powerDbm
    expect(powerDbm).toBeCloseTo(26.99, 1)
  })
  it('обратное преобразование: ввод дБм меняет мощность', () => {
    render(<EquipmentPanel />)
    fireEvent.change(inputByLabel('Мощность, дБм (dBm)'), { target: { value: '20' } })
    expect(useRadioStore.getState().equipment.transmitter.powerDbm).toBe(20)
  })
  it('0 мВт не даёт -Infinity (клампится к MIN_VALUE)', async () => {
    const user = userEvent.setup()
    render(<EquipmentPanel />)
    await user.click(screen.getByLabelText('Переключатель единиц мощности'))
    fireEvent.change(inputByLabel('Мощность, мВт (mW)'), { target: { value: '0' } })
    const powerDbm = useRadioStore.getState().equipment.transmitter.powerDbm
    expect(Number.isFinite(powerDbm)).toBe(true)
  })
})

describe('упрощённый / подробный режим', () => {
  it('в упрощённом режиме нет полей VSWR и NF', () => {
    render(<EquipmentPanel />)
    expect(screen.queryByText('КСВН (VSWR)')).not.toBeInTheDocument()
    expect(screen.queryByText('Коэффициент шума (NF), дБ')).not.toBeInTheDocument()
  })
  it('переключатель «Подробно» раскрывает полный набор полей', async () => {
    const user = userEvent.setup()
    render(<EquipmentPanel />)
    await user.click(screen.getByLabelText('Переключатель подробно/упрощённо'))
    expect(useRadioStore.getState().equipment.mode).toBe('detailed')
    expect(screen.getAllByText('КСВН (VSWR)')).toHaveLength(2)
    expect(screen.getByText('Коэффициент шума (NF), дБ')).toBeInTheDocument()
    expect(screen.getByText('Модуляция')).toBeInTheDocument()
    expect(screen.getAllByText('Ширина луча, °')).toHaveLength(2)
    expect(screen.getAllByText('Потери фидера, дБ')).toHaveLength(2)
  })
  it('усиление антенн редактируется (первое поле — Tx)', () => {
    render(<EquipmentPanel />)
    const gains = screen.getAllByText(/Усиление, дБи/)
    const input = gains[0].closest('div')!.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '15' } })
    expect(useRadioStore.getState().equipment.tx.gainDbi).toBe(15)
  })
  it('чувствительность приёмника редактируется', () => {
    render(<EquipmentPanel />)
    fireEvent.change(screen.getAllByDisplayValue('-100')[1], { target: { value: '-95' } })
    expect(useRadioStore.getState().equipment.receiver.sensitivityDbm).toBe(-95)
  })
})

describe('подробный режим: редактирование полей антенн и приёмника', () => {
  function detailInput(re: RegExp | string, idx = 0): HTMLInputElement {
    const labels = screen.getAllByText(re)
    const input = labels[idx].closest('div')!.querySelector('input')
    if (!input) throw new Error(`input not found for ${re}`)
    return input as HTMLInputElement
  }

  beforeEach(async () => {
    const user = userEvent.setup()
    render(<EquipmentPanel />)
    await user.click(screen.getByLabelText('Переключатель подробно/упрощённо'))
  })

  it('Tx: ширина луча, боковые лепестки, рассогласование, КСВН, фидер, азимут', () => {
    fireEvent.change(detailInput('Ширина луча, °', 0), { target: { value: '45' } })
    expect(useRadioStore.getState().equipment.tx.beamwidthDeg).toBe(45)
    fireEvent.change(detailInput('Ур. боковых лепестков, дБ', 0), { target: { value: '-30' } })
    expect(useRadioStore.getState().equipment.tx.sidelobeDb).toBe(-30)
    fireEvent.change(detailInput('Рассогласование, дБ', 0), { target: { value: '0.8' } })
    expect(useRadioStore.getState().equipment.tx.mismatchLossDb).toBe(0.8)
    fireEvent.change(detailInput('КСВН (VSWR)', 0), { target: { value: '2' } })
    expect(useRadioStore.getState().equipment.tx.vswr).toBe(2)
    fireEvent.change(detailInput('Потери фидера, дБ', 0), { target: { value: '3' } })
    expect(useRadioStore.getState().equipment.tx.feederLossDb).toBe(3)
    fireEvent.change(detailInput('Азимут, °', 0), { target: { value: '180' } })
    expect(useRadioStore.getState().equipment.tx.azimuthDeg).toBe(180)
  })
  it('Rx: те же поля независимы от Tx', () => {
    const txBefore = useRadioStore.getState().equipment.tx.beamwidthDeg
    fireEvent.change(detailInput('Ширина луча, °', 1), { target: { value: '60' } })
    expect(useRadioStore.getState().equipment.rx.beamwidthDeg).toBe(60)
    expect(useRadioStore.getState().equipment.tx.beamwidthDeg).toBe(txBefore)
    fireEvent.change(detailInput('КСВН (VSWR)', 1), { target: { value: '1.2' } })
    expect(useRadioStore.getState().equipment.rx.vswr).toBe(1.2)
  })
  it('приёмник: шумовая полоса, коэффициент шума, требуемое Eb/N0', () => {
    fireEvent.change(detailInput('Шумовая полоса, Гц'), { target: { value: '200000' } })
    expect(useRadioStore.getState().equipment.receiver.noiseBandwidthHz).toBe(200000)
    fireEvent.change(detailInput('Коэффициент шума (NF), дБ'), { target: { value: '6' } })
    expect(useRadioStore.getState().equipment.receiver.noiseFigureDb).toBe(6)
    fireEvent.change(detailInput('Требуемое Eb/N₀, дБ'), { target: { value: '12' } })
    expect(useRadioStore.getState().equipment.receiver.requiredEbN0Db).toBe(12)
  })
  it('Rx-часть «Мощность, дБм (Rx-часть)» редактируется', () => {
    fireEvent.change(detailInput('Мощность, дБм (Rx-часть)'), { target: { value: '-5' } })
    expect(useRadioStore.getState().equipment.receiver.powerDbm).toBe(-5)
  })
  it('пояснение о режимах присутствует', () => {
    expect(screen.getByText(/В упрощённом режиме: усиления антенн/)).toBeInTheDocument()
  })
})
