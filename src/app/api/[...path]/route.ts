/**
 * Сквозной прокси /api/* -> Python-сервис расчёта (FastAPI, мини-сервис radio-service).
 *
 * Песочница убивает фоновые процессы, запущенные из CLI, поэтому сервис
 * запускается лениво из процесса Next.js (system-supervised) при первом
 * обращении к /api/*, если он ещё не слушает порт 8000.
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BACKEND = process.env.RADIO_SERVICE_URL ?? 'http://127.0.0.1:8000'
const SERVICE_DIR = `${process.cwd()}/mini-services/radio-service`
const SERVICE_LOG = `${process.cwd()}/radio-service.log`
const HEALTH_TIMEOUT_MS = 800
const BOOT_WAIT_MS = 12_000

/** Python-интерпретатор с зависимостями сервиса (fastapi/uvicorn/numpy). */
const PYTHON_CANDIDATES = [
  process.env.RADIO_SERVICE_PYTHON,
  '/home/z/.venv/bin/python3',
  'python3',
].filter(Boolean) as string[]

type Ctx = { params: Promise<{ path: string[] }> }

let bootPromise: Promise<boolean> | null = null

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

/** Ленивый запуск Python-сервиса как child process Next.js-сервера. */
async function ensureBackend(): Promise<boolean> {
  if (!bootPromise) {
    bootPromise = bootstrap().catch(() => {
      bootPromise = null
      return false
    })
  }
  return bootPromise
}

async function bootstrap(): Promise<boolean> {
  if (await isUp()) return true

  const { spawn } = await import('node:child_process')
  const fs = await import('node:fs')
  const python = PYTHON_CANDIDATES.find((p) => p.includes('/') && fs.existsSync(p)) ?? PYTHON_CANDIDATES[0]
  const out = fs.openSync(SERVICE_LOG, 'a')
  const child = spawn(python, ['main.py'], {
    cwd: SERVICE_DIR,
    env: { ...process.env, PORT: '8000', PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', out, out],
    detached: true,
  })
  child.unref()

  const deadline = Date.now() + BOOT_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    if (await isUp()) return true
  }
  bootPromise = null // следующая попытка перезапустит сервис
  return false
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
])

async function proxy(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const ok = await ensureBackend()
  if (!ok) {
    return NextResponse.json(
      { detail: 'Сервис расчётов недоступен — не удалось запустить Python-сервис' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const target = `${BACKEND}/api/${path.join('/')}${url.search}`

  const headers = new Headers()
  const ct = req.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  const cl = req.headers.get('content-length')
  if (cl) headers.set('content-length', cl)
  headers.set('accept-encoding', 'identity')

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error duplex требуется для стриминга тела в undici
      duplex: hasBody ? 'half' : undefined,
      cache: 'no-store',
    })

    const resHeaders = new Headers()
    res.headers.forEach((value, key) => {
      const k = key.toLowerCase()
      if (HOP_BY_HOP.has(k) || k === 'content-encoding' || k === 'content-length') return
      resHeaders.set(key, value)
    })
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: resHeaders })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ detail: `Ошибка обращения к сервису расчётов: ${detail}` }, { status: 502 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
export async function OPTIONS(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx)
}
