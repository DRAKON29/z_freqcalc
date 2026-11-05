/**
 * Тесты Prisma-клиента (src/lib/db.ts): экспорт, синглтон в dev-режиме.
 * Клиент проверяем «утиной типизацией» — PrismaClient построен на Proxy,
 * instanceof в тестовой среде ненадёжен.
 */
import { describe, it, expect } from 'vitest'
import { db } from '../db'
import type { PrismaClient } from '@prisma/client'

describe('db.ts: Prisma-клиент', () => {
  it('экспортирует рабочий клиент (контракт API Prisma)', () => {
    expect(typeof db.$connect).toBe('function')
    expect(typeof db.$disconnect).toBe('function')
    expect(typeof db.$queryRaw).toBe('function')
    expect(typeof db.user).toBe('object')
    expect(db).not.toBeUndefined()
  })
  it('в dev-режиме кэшируется в globalThis (синглтон при hot-reload)', () => {
    const cached = (globalThis as unknown as { prisma?: PrismaClient }).prisma
    if (process.env.NODE_ENV !== 'production') {
      expect(cached).toBe(db)
    }
  })
})
