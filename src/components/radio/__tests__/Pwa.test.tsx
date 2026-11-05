/**
 * Тесты PWA: регистрация Service Worker, баннер установки (beforeinstallprompt).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PwaRegister, InstallBanner } from '../Pwa'

beforeEach(() => {
  window.dispatchEvent(new Event('beforeinstallprompt'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PwaRegister', () => {
  it('регистрирует /sw.js при поддержке serviceWorker', () => {
    const register = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })
    render(<PwaRegister />)
    expect(register).toHaveBeenCalledWith('/sw.js')
  })
  it('не падает, если serviceWorker недоступен (нет в navigator)', () => {
    // Убираем свойство, чтобы 'serviceWorker' in navigator === false (как в старых браузерах)
    Reflect.deleteProperty(navigator, 'serviceWorker')
    expect(() => render(<PwaRegister />)).not.toThrow()
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn().mockResolvedValue(undefined) } })
  })
  it('ошибка регистрации не роняет приложение', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const register = vi.fn().mockRejectedValue(new Error('SW failed'))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    render(<PwaRegister />)
    await waitFor(() => expect(warn).toHaveBeenCalledWith('SW registration failed:', expect.any(Error)))
  })
})

describe('InstallBanner', () => {
  it('по умолчанию скрыт (нет beforeinstallprompt)', () => {
    render(<InstallBanner />)
    expect(screen.queryByText(/Установите приложение на главный экран/)).not.toBeInTheDocument()
  })
  it('появляется после beforeinstallprompt', () => {
    render(<InstallBanner />)
    fireEvent(window, new Event('beforeinstallprompt'))
    expect(screen.getByText(/Установите приложение на главный экран/)).toBeInTheDocument()
  })
  it('кнопка «Установить» вызывает prompt и скрывает баннер', async () => {
    const user = userEvent.setup()
    const prompt = vi.fn().mockResolvedValue({ outcome: 'accepted' })
    render(<InstallBanner />)
    // Событие с методом prompt (как real BeforeInstallPromptEvent)
    const ev = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<unknown> }
    ev.prompt = prompt
    fireEvent(window, ev)
    expect(screen.getByText(/Установите приложение на главный экран/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Установить' }))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Установите приложение на главный экран/)).not.toBeInTheDocument()
  })
  it('кнопка «Скрыть» убирает баннер', async () => {
    const user = userEvent.setup()
    render(<InstallBanner />)
    fireEvent(window, new Event('beforeinstallprompt'))
    await user.click(screen.getByLabelText('Скрыть'))
    expect(screen.queryByText(/Установите приложение/)).not.toBeInTheDocument()
  })
})
