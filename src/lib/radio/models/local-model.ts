/**
 * LocalPropagationModel — полностью локальный расчёт в TypeScript,
 * без HTTP-сервиса и без Pyodide: детерминированный fallback.
 *   p2001     → computeP2001Lite (статистическая аппроксимация P.2001)
 *   fspl-p526 → computeFsplP526   (FSPL (P.525) + P.526 + P.838)
 */
import type { CalculationInput, ModelId, PropagationModel, PropagationResult, ModelCapabilities } from '../types'
import { computeFsplP526, computeP2001Lite } from '../p2001lite'

export class LocalPropagationModel implements PropagationModel {
  constructor(private modelId: ModelId) {}

  async calculate(input: CalculationInput): Promise<PropagationResult> {
    return this.modelId === 'p2001' ? computeP2001Lite(input) : computeFsplP526(input)
  }

  getCapabilities(): ModelCapabilities {
    return {
      model: this.modelId,
      supportsTimePercent: this.modelId === 'p2001',
      supportsMaps: false,
      minFrequencyMhz: 30,
      maxFrequencyMhz: 50000,
      requiresBackend: false,
      description:
        this.modelId === 'p2001'
          ? 'P.2001-lite локально (TypeScript); офлайн-режим; без карт ITU'
          : 'FSPL (P.525) + P.526 локально (TypeScript)',
    }
  }
}
