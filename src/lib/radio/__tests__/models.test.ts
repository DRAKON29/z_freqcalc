/**
 * Тесты моделей распространения: фабрика, http (с fallback), wasm, local,
 * конфигурация api.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createModel, defaultBackend } from '../models'
import { HttpPropagationModel } from '../models/http-model'
import { WasmPropagationModel } from '../models/wasm-model'
import { LocalPropagationModel } from '../models/local-model'
import { apiBase, apiUrl, apiPortQuery } from '../models/api'
import { makeInput } from './fixtures'
import { computeFsplP526 } from '../p2001lite'
import type { PropagationResult } from '../types'

const input = makeInput()

const fakeProp: PropagationResult = {
  model: 'p2001',
  medianLossDb: 140,
  byTimePercent: [{ percent: 50, lossDb: 140 }],
  breakdown: { freeSpaceDb: 128, diffractionDb: 12 },
  engineUsed: 'Python: P.2001',
  warnings: [],
}

describe('api.ts: конфигурация адреса сервиса', () => {
  const prevBase = process.env.NEXT_PUBLIC_API_BASE
  const prevPort = process.env.NEXT_PUBLIC_API_PORT

  afterEach(() => {
    if (prevBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE
    else process.env.NEXT_PUBLIC_API_BASE = prevBase
    if (prevPort === undefined) delete process.env.NEXT_PUBLIC_API_PORT
    else process.env.NEXT_PUBLIC_API_PORT = prevPort
  })

  it('по умолчанию база /api, без порта', () => {
    delete process.env.NEXT_PUBLIC_API_BASE
    delete process.env.NEXT_PUBLIC_API_PORT
    expect(apiBase()).toBe('/api')
    expect(apiPortQuery()).toBe('')
    expect(apiUrl('/health')).toBe('/api/health')
  })
  it('заданный порт добавляется как XTransformPort', () => {
    process.env.NEXT_PUBLIC_API_PORT = '8000'
    expect(apiUrl('/calculate')).toContain('?XTransformPort=8000')
  })
  it('заданная база подставляется', () => {
    process.env.NEXT_PUBLIC_API_BASE = 'http://localhost:9000'
    expect(apiUrl('/history')).toBe('http://localhost:9000/history')
  })
})

describe('defaultBackend / createModel (фабрика)', () => {
  const prev = process.env.NEXT_PUBLIC_MODEL_BACKEND

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_MODEL_BACKEND
    else process.env.NEXT_PUBLIC_MODEL_BACKEND = prev
  })

  it('по умолчанию http', () => {
    delete process.env.NEXT_PUBLIC_MODEL_BACKEND
    expect(defaultBackend()).toBe('http')
    expect(createModel('http', 'p2001')).toBeInstanceOf(HttpPropagationModel)
  })
  it('NEXT_PUBLIC_MODEL_BACKEND=wasm → wasm', () => {
    process.env.NEXT_PUBLIC_MODEL_BACKEND = 'wasm'
    expect(defaultBackend()).toBe('wasm')
  })
  it('createModel возвращает нужные классы', () => {
    expect(createModel('wasm', 'fspl-p526')).toBeInstanceOf(WasmPropagationModel)
    expect(createModel('http', 'fspl-p526')).toBeInstanceOf(HttpPropagationModel)
  })
})

describe('HttpPropagationModel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('успешный ответ сервера: propagation из JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ propagation: fakeProp }),
    } as never)
    const m = new HttpPropagationModel('p2001')
    const r = await m.calculate(input)
    expect(r.medianLossDb).toBe(140)
    expect(r.model).toBe('p2001')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/calculate'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
  it('если ответ без обёртки — берётся тело целиком', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...fakeProp }),
    } as never)
    const r = await new HttpPropagationModel('p2001').calculate(input)
    expect(r.engineUsed).toBe('Python: P.2001')
  })
  it('HTTP 500 → fallback на локальную модель с предупреждением', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' } as never)
    const r = await new HttpPropagationModel('p2001').calculate(input)
    expect(r.warnings[0]).toContain('Python-сервис недоступен')
    expect(r.warnings[0]).toContain('HTTP 500')
    expect(r.engineUsed).toContain('P.2001-lite')
  })
  it('сеть недоступна → fallback и для fspl-p526', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const r = await new HttpPropagationModel('fspl-p526').calculate(input)
    expect(r.warnings[0]).toContain('выполнен локальный расчёт FSPL + P.526')
    expect(r.medianLossDb).toBe(computeFsplP526(input).medianLossDb)
  })
  it('capabilities: p2001 поддерживает проценты времени и карты', () => {
    const caps = new HttpPropagationModel('p2001').getCapabilities()
    expect(caps.supportsTimePercent).toBe(true)
    expect(caps.supportsMaps).toBe(true)
    expect(caps.requiresBackend).toBe(true)
    const caps2 = new HttpPropagationModel('fspl-p526').getCapabilities()
    expect(caps2.supportsMaps).toBe(false)
  })
})

describe('WasmPropagationModel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fspl-p526 в wasm-режиме считается локально (без Pyodide)', async () => {
    const r = await new WasmPropagationModel('fspl-p526').calculate(input)
    expect(r.model).toBe('fspl-p526')
    expect(r.medianLossDb).toBe(computeFsplP526(input).medianLossDb)
  })
  it('p2001 без Pyodide → fallback с предупреждением (детерминированный сбой загрузки CDN)', async () => {
    // jsdom не загружает внешние скрипты: имитируем немедленный onerror для <script>,
    // чтобы путь fallback был воспроизводим (иначе тест зависит от тайминга jsdom)
    const origCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'script') {
        setTimeout(() => el.onerror?.(new Event('error')), 0)
      }
      return el
    })
    void spy
    const r = await new WasmPropagationModel('p2001').calculate(input)
    expect(r.warnings.some((w) => w.includes('fallback на FSPL'))).toBe(true)
    expect(r.engineUsed).toContain('FSPL')
  })
  it('capabilities: maps недоступны в wasm-режиме', () => {
    const caps = new WasmPropagationModel('p2001').getCapabilities()
    expect(caps.supportsMaps).toBe(false)
    expect(caps.requiresBackend).toBe(false)
  })
})

describe('LocalPropagationModel', () => {
  it('возвращает детерминированный расчёт FSPL+P.526', async () => {
    const m = new LocalPropagationModel('fspl-p526')
    const r = await m.calculate(input)
    expect(r.medianLossDb).toBe(computeFsplP526(input).medianLossDb)
    expect(m.getCapabilities().description).toContain('P.526')
  })
})
