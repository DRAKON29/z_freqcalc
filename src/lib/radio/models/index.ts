/**
 * Фабрика моделей распространения (ТЗ 3.1, 6.3).
 * Бэкенд по умолчанию — переменная окружения NEXT_PUBLIC_MODEL_BACKEND (http | wasm),
 * переключение в UI доступно при запущенном сервисе.
 */
import type { BackendId, ModelId, PropagationModel } from '../types'
import { HttpPropagationModel } from './http-model'
import { WasmPropagationModel } from './wasm-model'
import { LocalPropagationModel } from './local-model'

export function defaultBackend(): BackendId {
  const env = process.env.NEXT_PUBLIC_MODEL_BACKEND
  return env === 'wasm' ? 'wasm' : 'http'
}

export function createModel(backend: BackendId, modelId: ModelId): PropagationModel {
  if (backend === 'wasm') return new WasmPropagationModel(modelId)
  return new HttpPropagationModel(modelId)
}
