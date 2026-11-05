/**
 * Тесты HistoryPanel: список записей, фильтры, экспорт JSON/CSV/PDF,
 * загрузка записи в форму, синхронизация, очистка.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryPanel } from '../HistoryPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore } from './test-utils'
import { saveHistory, clearHistory, getDeviceId } from '@/lib/radio/history'
import { makeHistoryEntry } from '../../../lib/radio/__tests__/fixtures'

// PDF-модуль мокается: jsPDF + шрифты уже покрыты в pdf.test.ts
vi.mock('@/lib/radio/pdf', () => ({
  historyEntriesToPdfBlob: vi.fn(async () => new Blob(['%PDF-fake'], { type: 'application/pdf' })),
}))
vi.mock('@/lib/radio/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/radio/export')>()
  return { ...actual, download: vi.fn() }
})

beforeEach(async () => {
  resetStore()
  localStorage.clear()
  await clearHistory(getDeviceId())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Перехват клика по ссылкам скачивания (без поломки createElement). */
function spyAnchorClick() {
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

async function seedOneEntry() {
  // Запись привязывается к реальному device_id (история фильтруется по нему)
  const base = makeHistoryEntry({ deviceId: getDeviceId() })
  await saveHistory({ ...base, input: base.input, budget: base.budget })
}

describe('список истории', () => {
  it('пустая история → приглашение', async () => {
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText(/Расчётов пока нет/)).toBeInTheDocument())
  })
  it('сохранённая запись отображается с частотой, длиной, потерями, запасом', async () => {
    await seedOneEntry()
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    expect(screen.getByText('2000 МГц')).toBeInTheDocument()
    expect(screen.getByText('30.0 км')).toBeInTheDocument()
    expect(screen.getByText('128.5 дБ')).toBeInTheDocument()
    expect(screen.getByText('12.3 дБ')).toBeInTheDocument()
  })
  it('device_id показан (первые 8 символов)', async () => {
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText(/device_id:/)).toBeInTheDocument())
  })
})

describe('экспорт', () => {
  it('кнопка PDF заблокирована для пустой истории', () => {
    render(<HistoryPanel />)
    expect(screen.getByRole('button', { name: /Экспорт PDF/ })).toBeDisabled()
  })
  it('экспорт PDF: собирает Blob и вызывает download-подобное поведение', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    const createObjectURL = vi.fn(() => 'blob:pdf')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = spyAnchorClick()

    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByTitle('Экспорт PDF (лист на расчёт)'))
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
    })
    expect(vi.mocked(await import('@/lib/radio/pdf')).historyEntriesToPdfBlob).toHaveBeenCalledTimes(1)
  })
  it('экспорт JSON всего списка вызывает download', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    // Нижняя кнопка «Экспорт JSON» (без title) — экспорт всего списка;
    // верхняя с title — экспорт одной записи
    await user.click(screen.getAllByRole('button', { name: 'Экспорт JSON' }).at(-1)!)
    const { download } = await import('@/lib/radio/export')
    expect(download).toHaveBeenCalledWith('история-расчётов.json', expect.stringContaining('"entries"'), 'application/json')
  })
  it('экспорт CSV истории вызывает download с заголовком', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Экспорт CSV' }))
    const { download } = await import('@/lib/radio/export')
    expect(download).toHaveBeenCalledWith('история-расчётов.csv', expect.stringContaining('Дата;Название;Модель'), 'text/csv')
  })
  it('ошибка формирования PDF показывается пользователю', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    vi.mocked(await import('@/lib/radio/pdf')).historyEntriesToPdfBlob.mockRejectedValueOnce(new Error('шрифт недоступен'))
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByTitle('Экспорт PDF (лист на расчёт)'))
    await waitFor(() => expect(screen.getByText(/Не удалось сформировать PDF/)).toBeInTheDocument())
  })
})

describe('действия с записями', () => {
  it('загрузка записи восстанавливает входные данные в store', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByTitle('Загрузить в форму'))
    await waitFor(() => {
      expect(useRadioStore.getState().pointA).toEqual(makeHistoryEntry().input.path.points[0])
    })
  })
  it('удаление записи очищает историю', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByTitle('Удалить запись'))
    await waitFor(() => expect(screen.getByText(/Расчётов пока нет/)).toBeInTheDocument())
  })
  it('очистка всей истории', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Очистить историю/ }))
    await waitFor(() => expect(screen.getByText(/Расчётов пока нет/)).toBeInTheDocument())
  })
})

describe('синхронизация', () => {
  it('кнопка «Синхронизировать» показывает итог с количеством', async () => {
    const user = userEvent.setup()
    await seedOneEntry()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(<HistoryPanel />)
    await waitFor(() => expect(screen.getByText('30.0 км @ 2000 МГц')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Синхронизировать/ }))
    await waitFor(() => expect(screen.getByText(/Отправлено: 1, ошибок: 0/)).toBeInTheDocument())
    vi.unstubAllGlobals()
  })
  it('описание экспорта PDF упоминает состав листа: частота, координаты, профиль, бюджет', () => {
    render(<HistoryPanel />)
    expect(screen.getByText(/каждый лист содержит основные данные расчёта/)).toBeInTheDocument()
    expect(screen.getByText(/частоту, координаты приёмника и передатчика/)).toBeInTheDocument()
    expect(screen.getByText(/профиль рельефа с основными линиями/)).toBeInTheDocument()
    expect(screen.getByText(/бюджет линии/)).toBeInTheDocument()
  })
})
