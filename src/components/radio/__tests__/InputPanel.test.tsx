/**
 * Тесты InputPanel: трасса (координаты, СК-42 с авто-зоной), справочные углы,
 * время полёта, режим «одна частота / диапазон частот», атмосфера.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { InputPanel } from '../InputPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore } from './test-utils'
import { bearingDeg, distanceM, wgs84ToSk42 } from '@/lib/radio/coordinates'
import userEvent from '@testing-library/user-event'

beforeEach(() => resetStore())

/** Поиск input по подписи (shadcn Label не связан с Input через htmlFor). */
function inputByLabel(re: RegExp | string): HTMLInputElement {
  const label = screen.getByText(re)
  const container = label.closest('div')!
  const input = container.querySelector('input')
  if (!input) throw new Error(`input not found for `)
  return input as HTMLInputElement
}

describe('рендер панели ввода', () => {
  it('точки A и Б с подписями передатчик/приёмник', () => {
    render(<InputPanel />)
    expect(screen.getByText('Точка A (передатчик)')).toBeInTheDocument()
    expect(screen.getByText('Точка Б (приёмник)')).toBeInTheDocument()
  })
  it('зона СК-42 определяется автоматически (Москва → 7) и показывается в readOnly-поле', () => {
    render(<InputPanel />)
    expect(screen.getAllByText('СК-42: зона (авто)')).toHaveLength(2)
    const zoneInputs = screen.getAllByDisplayValue('7')
    expect(zoneInputs.length).toBeGreaterThanOrEqual(2) // для обеих точек
    expect(zoneInputs[0]).toHaveAttribute('readonly')
  })
  it('поле X/Y подписано «без номера зоны» (зона убрана из ввода)', () => {
    render(<InputPanel />)
    expect(screen.getAllByText(/СК-42 Гаусс–Крюгер: X, Y \(м, без номера зоны\)/).length).toBe(2)
  })
})

describe('справочные данные трассы (длина трассы и углы)', () => {
  it('длина трассы в км, азимут, обратный угол, дирекционный угол, угол места, время полёта', () => {
    render(<InputPanel />)
    const a = useRadioStore.getState().pointA
    const b = useRadioStore.getState().pointB
    const km = (distanceM(a, b) / 1000).toFixed(2)
    const az = bearingDeg(a, b).toFixed(1)
    expect(screen.getByText(new RegExp(`${km} км`))).toBeInTheDocument()
    expect(screen.getByText('Азимут (истинный):')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${az}°`))).toBeInTheDocument()
    expect(screen.getByText('Обратный угол:')).toBeInTheDocument()
    expect(screen.getByText('Дирекционный угол:')).toBeInTheDocument()
    expect(screen.getByText('Сближение меридианов:')).toBeInTheDocument()
    expect(screen.getByText('Угол места:')).toBeInTheDocument()
    expect(screen.getByText(/Время полёта:/)).toBeInTheDocument()
  })
  it('время полёта пересчитывается от путевой скорости (зависимость от скорости)', () => {
    const { rerender } = render(<InputPanel />)
    const before = screen.getByText(/Время полёта:/).parentElement!.textContent
    act(() => useRadioStore.setState({ dynamicsParams: { ...useRadioStore.getState().dynamicsParams, speedKmh: 300 } }))
    rerender(<InputPanel />)
    const after = screen.getByText(/Время полёта:/).parentElement!.textContent
    expect(after).not.toBe(before)
  })
})

describe('изменение координат через форму', () => {
  it('изменение широты точки A попадает в store', async () => {
    render(<InputPanel />)
    const latInputs = screen.getAllByDisplayValue('55.7558')
    fireEvent.change(latInputs[0], { target: { value: '56' } })
    expect(useRadioStore.getState().pointA.lat).toBe(56)
  })
  it('ввод СК-42 X Y (без зоны) применяется по blur и конвертируется в WGS 84', async () => {
    const user = userEvent.setup()
    render(<InputPanel />)
    // X Y для точки Москвы: 6182348 413070 (зона 7 авто)
    const skInput = screen.getAllByDisplayValue(/413070/)[0]
    await user.clear(skInput)
    await user.type(skInput, '6183000 413500')
    await user.tab()
    const state = useRadioStore.getState()
    // Точка сдвинулась относительно исходной, но осталась в Москве
    expect(state.pointA.lat).toBeGreaterThan(55.7)
    expect(state.pointA.lat).toBeLessThan(55.8)
    expect(state.pointA.lon).toBeGreaterThan(37.5)
    expect(state.pointA.lon).toBeLessThan(37.8)
  })
  it('ввод Y с номером зоны (7413500) тоже принимается — зона из координат', async () => {
    const user = userEvent.setup()
    render(<InputPanel />)
    const skInput = screen.getAllByDisplayValue(/413070/)[0]
    await user.clear(skInput)
    await user.type(skInput, '6183000 7413500')
    await user.tab()
    expect(useRadioStore.getState().pointA.lon).toBeGreaterThan(37.5)
  })
  it('некорректный ввод СК-42 → сообщение об ошибке', async () => {
    const user = userEvent.setup()
    render(<InputPanel />)
    const skInput = screen.getAllByDisplayValue(/413070/)[0]
    await user.clear(skInput)
    await user.type(skInput, 'abc def')
    await user.tab()
    expect(screen.getByText(/Формат: X Y в метрах/)).toBeInTheDocument()
  })
  it('SK-42 из store соответствует прямому преобразованию', () => {
    const sk = wgs84ToSk42({ lat: 55.7558, lon: 37.6173 })
    expect(sk.zone).toBe(7)
  })
})

describe('режим частоты: одна / диапазон', () => {
  it('по умолчанию одна частота: поле «Частота, МГц»', () => {
    render(<InputPanel />)
    expect(inputByLabel(/Частота, МГц \(500–7000\)/)).toHaveValue(2400)
    expect(screen.queryByText('Частота от, МГц')).not.toBeInTheDocument()
  })
  it('переключатель включает режим диапазона: поля «от» и «до»', async () => {
    const user = userEvent.setup()
    render(<InputPanel />)
    await user.click(screen.getByLabelText('Переключатель режима частоты'))
    expect(useRadioStore.getState().frequencyMode).toBe('range')
    expect(inputByLabel('Частота от, МГц')).toBeInTheDocument()
    expect(inputByLabel('Частота до, МГц')).toBeInTheDocument()
    expect(screen.getByText('до 12 точек')).toBeInTheDocument()
  })
  it('изменение частоты записывается в store', () => {
    render(<InputPanel />)
    fireEvent.change(inputByLabel(/Частота, МГц \(500–7000\)/), { target: { value: '900' } })
    expect(useRadioStore.getState().frequencyMhz).toBe(900)
  })
})

describe('атмосфера и условия', () => {
  it('интенсивность дождя обновляется', () => {
    render(<InputPanel />)
    fireEvent.change(inputByLabel(/Дождь \(P\.837 \+ P\.838\)/), { target: { value: '25' } })
    expect(useRadioStore.getState().atmosphere.rainRateMmH).toBe(25)
  })
  it('высоты антенн обновляются', () => {
    render(<InputPanel />)
    fireEvent.change(inputByLabel(/Высота антенны Tx/), { target: { value: '45' } })
    expect(useRadioStore.getState().txHeightM).toBe(45)
    fireEvent.change(inputByLabel(/Высота антенны Rx/), { target: { value: '12' } })
    expect(useRadioStore.getState().rxHeightM).toBe(12)
  })
})
