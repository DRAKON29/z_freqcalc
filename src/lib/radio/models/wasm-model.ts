/**
 * WasmPropagationModel — запуск Python-модели в браузере через Pyodide.
 * Pyodide загружается лениво с CDN; код P.2001-lite берётся из /py/p2001_lite.py
 * (прекэшируется Service Worker'ом → работает офлайн).
 *
 * Fallback: при недоступности Pyodide — FSPL + P.526 локально,
 * причина возвращается в warnings.
 */
import type { CalculationInput, ModelId, PropagationModel, PropagationResult, ModelCapabilities } from '../types'
import { computeFsplP526, computeP2001Lite } from '../p2001lite'
import type { PyodideInterface } from 'pyodide'

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface>
  }
}

let pyodidePromise: Promise<PyodideInterface> | null = null

/** Ленивая загрузка Pyodide (CDN jsDelivr). */
async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js'
      script.async = true
      const loaded = new Promise<void>((resolve, reject) => {
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Не удалось загрузить pyodide.js с CDN'))
      })
      document.head.appendChild(script)
      await loaded
      if (!window.loadPyodide) throw new Error('loadPyodide недоступен')
      const py = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' })
      const code = await fetch('/py/p2001_lite.py').then((r) => {
        if (!r.ok) throw new Error('p2001_lite.py не найден')
        return r.text()
      })
      py.runPython(code)
      return py
    })()
    pyodidePromise.catch(() => {
      pyodidePromise = null
    })
  }
  return pyodidePromise
}

export class WasmPropagationModel implements PropagationModel {
  constructor(private modelId: ModelId) {}

  async calculate(input: CalculationInput): Promise<PropagationResult> {
    if (this.modelId === 'itm') {
      // ITM реализован только в python-сервисе (роадмап 2.1): в wasm-режиме —
      // локальный P.2001-lite с явным предупреждением
      const local = computeP2001Lite(input)
      return {
        ...local,
        model: this.modelId,
        warnings: [
          'ITM доступен только через Python-сервис (http-бэкенд) — в wasm-режиме выполнен локальный расчёт P.2001-lite.',
          ...local.warnings,
        ],
      }
    }
    if (this.modelId !== 'p2001') {
   // «FSPL + P.526» в wasm-режиме считается локально
      return computeFsplP526(input)
    }
    try {
      const py = await getPyodide()
      const jsonInput = JSON.stringify(input)
      const json = py.runPython(`p2001_lite_calculate(${JSON.stringify(jsonInput)})`) as string
      const result = JSON.parse(json) as PropagationResult
      return {
        ...result,
        engineUsed: `WASM/Pyodide: ${result.engineUsed}`,
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
   // fallback на FSPL + P.526
      const local = computeFsplP526(input)
      return {
        ...local,
        warnings: [
          `Pyodide недоступен (${reason}) — выполнен fallback на FSPL + P.526.`,
          ...local.warnings,
        ],
      }
    }
  }

  getCapabilities(): ModelCapabilities {
    return {
      model: this.modelId,
      supportsTimePercent: this.modelId === 'p2001' || this.modelId === 'itm',
      supportsMaps: false,
      minFrequencyMhz: 30,
      maxFrequencyMhz: 50000,
      requiresBackend: false,
      description:
        this.modelId === 'p2001'
          ? 'P.2001-lite в браузере (Pyodide/WASM); офлайн-режим; без карт ITU'
          : this.modelId === 'itm'
            ? 'ITM недоступен в браузере — локальный расчёт P.2001-lite с предупреждением'
            : 'FSPL + P.526 локально в браузере',
    }
  }
}
