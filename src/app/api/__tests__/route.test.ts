/**
 * Тесты API-роута приложения (/api).
 */
import { describe, it, expect } from 'vitest'
import { GET } from '../route'

describe('GET /api', () => {
  it('возвращает JSON с приветствием', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ message: 'Hello, world!' })
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
