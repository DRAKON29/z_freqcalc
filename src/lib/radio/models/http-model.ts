/**
 * HttpPropagationModel — расчёт через Python (FastAPI) сервис.
 * приоритетная модель ITU-R P.2001-6: полная реализация Py2001 (вендоренный
 * порт ITU-R WP 3M, p2001_port + P2001.npz из карт ITU); при отсутствии карт
 * на сервере — P.2001-lite. При недоступности сервиса — fallback на локальную
 * модель с предупреждением.
 */
import type { CalculationInput, ModelId, PropagationModel, PropagationResult, ModelCapabilities } from '../types'
import { computeFsplP526, computeP2001Lite } from '../p2001lite'
import { apiUrl } from './api'

export class HttpPropagationModel implements PropagationModel {
  constructor(private modelId: ModelId) {}

  async calculate(input: CalculationInput): Promise<PropagationResult> {
    try {
      const res = await fetch(apiUrl('/calculate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.modelId, input }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      const data = (await res.json()) as { propagation?: PropagationResult } & PropagationResult
      const prop = data.propagation ?? data
      return { ...prop, model: this.modelId }
    } catch (e) {
   // Fallback
      const reason = e instanceof Error ? e.message : String(e)
      // ITM и P.528 реализованы только в python-сервисе (роадмап 2.1/3.5,
      // TS-порты отсутствуют — задокументированный разрыв): при недоступности
      // сервиса — P.2001-lite
      const local = this.modelId === 'fspl-p526' ? computeFsplP526(input) : computeP2001Lite(input)
      const localName = this.modelId === 'fspl-p526' ? 'FSPL + P.526' : 'P.2001-lite'
      const backendOnlyNote =
        this.modelId === 'itm'
          ? 'ITM доступен только через Python-сервис — '
          : this.modelId === 'p528'
            ? 'P.528 доступен только через Python-сервис — '
            : ''
      return {
        ...local,
        model: this.modelId,
        warnings: [
          `${backendOnlyNote}Python-сервис недоступен (${reason}) — выполнен локальный расчёт ${localName}.`,
          ...local.warnings,
        ],
      }
    }
  }

  getCapabilities(): ModelCapabilities {
    return {
      model: this.modelId,
      supportsTimePercent: this.modelId === 'p2001' || this.modelId === 'itm' || this.modelId === 'p528',
      supportsMaps: this.modelId === 'p2001',
      minFrequencyMhz: 30,
      maxFrequencyMhz: 50000,
      requiresBackend: true,
      description:
        this.modelId === 'p2001'
          ? 'ITU-R P.2001-6 через FastAPI-сервис: полная реализация Py2001 + карты ITU (P2001.npz), при их отсутствии — P.2001-lite'
          : this.modelId === 'itm'
            ? 'Longley-Rice ITM v1.2.2 через FastAPI-сервис (порт NTIA/ITS); локальной реализации нет — при недоступности сервиса fallback на P.2001-lite'
            : this.modelId === 'p528'
              ? 'ITU-R P.528-5 через FastAPI-сервис (порт эталонной реализации NTIA); авиационная модель по гладкой сфере — при недоступности сервиса fallback на P.2001-lite'
              : 'FSPL + P.526 через FastAPI-сервис',
    }
  }
}
