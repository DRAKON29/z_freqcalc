/**
 * Глобальная подготовка среды для всех тестов:
 *  • matchers @testing-library/jest-dom;
 *  • fake-indexeddb вместо IndexedDB (jsdom его не содержит);
 *  • заглушки matchMedia, ResizeObserver, scrollTo, URL.createObjectURL;
 *  • детерминированный crypto.randomUUID (jsdom 22+ уже даёт; страховка для старых).
 */
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { vi, beforeAll, afterAll } from 'vitest'

// ---- matchMedia (нужен use-mobile, leaflet, тултипам) ----
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

// ---- ResizeObserver (recharts, leaflet) ----
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
}

// ---- URL.createObjectURL / revokeObjectURL ----
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
}

// ---- scrollTo ----
if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = vi.fn()
}

// ---- Radix Select: Pointer Capture API и scrollIntoView в jsdom отсутствуют ----
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
  window.HTMLElement.prototype.setPointerCapture ??= () => {}
  window.HTMLElement.prototype.releasePointerCapture ??= () => {}
  window.HTMLElement.prototype.scrollIntoView ??= () => {}
  // в jsdom нет реального канваса — рисование диаграмм в тестах безопасно заглушено
  window.HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof window.HTMLCanvasElement.prototype.getContext
}

// ---- AbortSignal.timeout есть в Node 18+; страховка не нужна, но проверим ----
// ---- Тихий console.error для ожидаемых предупреждений React act() ----
const origError = console.error
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = String(args[0] ?? '')
    if (msg.includes('not wrapped in act') || msg.includes('Warning: An update to')) return
    origError(...args)
  })
})
afterAll(() => {
  vi.restoreAllMocks()
})

// jsPDF и модули приложения обращаются к navigator.userAgent — jsdom его даёт.
// Стабилизируем русский формат даты в тестах (не влияет на логику).
process.env.TZ = 'Europe/Moscow'
