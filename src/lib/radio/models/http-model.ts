/**
 * HttpPropagationModel — расчёт через Python (FastAPI) сервис.
 * приоритетная модель ITU-R P.2001 (py2001 или P.2001-lite на сервере).
 * При недоступности сервиса — fallback на локальную модель с предупреждением.
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
      const local = this.modelId === 'p2001' ? computeP2001Lite(input) : computeFsplP526(input)
      return {
        ...local,
        warnings: [
          `Python-сервис недоступен (${reason}) — выполнен локальный расчёт${this.modelId === 'p2001' ? ' P.2001-lite' : ' FSPL + P.526'}.`,
          ...local.warnings,
        ],
      }
    }
  }

  getCapabilities(): ModelCapabilities {
    return {
      model: this.modelId,
      supportsTimePercent: this.modelId === 'p2001',
      supportsMaps: this.modelId === 'p2001',
      minFrequencyMhz: 30,
      maxFrequencyMhz: 50000,
      requiresBackend: true,
      description:
        this.modelId === 'p2001'
          ? 'ITU-R P.2001 через FastAPI-сервис (py2001 или P.2001-lite), поддержка карт ITU'
          : 'FSPL + P.526 через FastAPI-сервис',
    }
  }
}
