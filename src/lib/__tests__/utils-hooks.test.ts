/**
 * Тесты утилит и хуков: cn(), useIsMobile, use-toast (reducer + toast()).
 */
import { describe, it, expect } from 'vitest'
import { cn } from '../utils'
import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToast, toast, reducer } from '@/hooks/use-toast'

describe('cn(): слияние классов tailwind-merge', () => {
  it('объединяет классы', () => {
    expect(cn('a', 'b')).toBe('a b')
  })
  it('конфликтующие классы — побеждает последний', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })
  it('условные значения clsx', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
})

describe('useIsMobile', () => {
  it('при ширине окна 1024 → false (десктоп)', () => {
    window.innerWidth = 1024
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })
  it('при ширине 375 → true (мобильный)', () => {
    window.innerWidth = 375
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })
})

describe('use-toast: reducer', () => {
  // Типы выводим из самого reducer'а — не дублируем внутренние типы хука
  type RedState = ReturnType<typeof reducer>
  type RedAction = Parameters<typeof reducer>[1]
  type RedToast = Extract<RedAction, { type: 'ADD_TOAST' }>['toast']
  const t = (id: string): RedToast => ({ id, open: true, title: id }) as RedToast

  it('ADD_TOAST ограничивает лимит (1) — новые вытесняют старые', () => {
    let state: RedState = { toasts: [] }
    state = reducer(state, { type: 'ADD_TOAST', toast: t('1') })
    state = reducer(state, { type: 'ADD_TOAST', toast: t('2') })
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].id).toBe('2')
  })
  it('UPDATE_TOAST сливает поля по id', () => {
    let state: RedState = { toasts: [t('1')] }
    state = reducer(state, { type: 'UPDATE_TOAST', toast: { id: '1', title: 'обновлено' } })
    expect(state.toasts[0].title).toBe('обновлено')
  })
  it('DISMISS_TOAST закрывает конкретный тост и все без id', () => {
    let state: RedState = { toasts: [t('1'), t('2')] }
    state = reducer(state, { type: 'DISMISS_TOAST', toastId: '1' })
    expect(state.toasts.find((x) => x.id === '1')?.open).toBe(false)
    expect(state.toasts.find((x) => x.id === '2')?.open).toBe(true)
    state = reducer(state, { type: 'DISMISS_TOAST' })
    expect(state.toasts.every((x) => !x.open)).toBe(true)
  })
  it('REMOVE_TOAST: без id очищает всё, с id — только конкретный', () => {
    let state: RedState = { toasts: [t('1'), t('2')] }
    state = reducer(state, { type: 'REMOVE_TOAST', toastId: '1' })
    expect(state.toasts).toHaveLength(1)
    state = reducer(state, { type: 'REMOVE_TOAST' })
    expect(state.toasts).toHaveLength(0)
  })
})

describe('use-toast: toast() API', () => {
  it('toast() создаёт тост, dismiss() закрывает', () => {
    const { result } = renderHook(() => useToast())
    let created: ReturnType<typeof toast> | null = null
    act(() => {
      created = result.current.toast({ title: 'Тестовый тост' })
    })
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].title).toBe('Тестовый тост')
    act(() => {
      created!.dismiss()
    })
    expect(result.current.toasts[0].open).toBe(false)
  })
})
