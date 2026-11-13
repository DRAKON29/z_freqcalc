/**
 * Тест заготовки mesh (этап UX.6): расчёт сети не реализован — точка расширения
 * обязана бросать исключение, чтобы заготовка не выдавала себя за результат.
 */
import { describe, it, expect } from 'bun:test'
import { evaluateMeshChain, type MeshChain, type MeshLink } from '../src/lib/radio/mesh'

describe('mesh stub (UX.6)', () => {
  it('evaluateMeshChain бросает понятное исключение', () => {
    const link: MeshLink = { id: 'l1', from: { lat: 55.0, lon: 37.0 }, to: { lat: 55.1, lon: 37.1 } }
    const chain: MeshChain = { id: 'c1', name: 'тест', links: [link] }
    expect(() => evaluateMeshChain(chain)).toThrow('этап 2.4 ROADMAP заморожен')
  })
})
