/**
 * Service Worker — ТЗ 4.10:
 *  • precache HTML/CSS/JS/иконки (оболочка приложения);
 *  • runtime cache /api/* — stale-while-revalidate, TTL 1 ч;
 *  • офлайн-fallback: кэшированная оболочка (включая /py/p2001_lite.py для Pyodide-модели).
 */
const CACHE = 'radio-calc-v2'
const API_TTL_MS = 60 * 60 * 1000 // 1 час

// Precache — только стабильные ресурсы (иконки, манифест, Python-модуль для Pyodide)
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/py/p2001_lite.py',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // POST /api/calculate — всегда сеть

  const url = new URL(req.url)

  // Навигация: сеть → кэш (офлайн — оболочка с историей расчётов)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    )
    return
  }

  // /api/*: stale-while-revalidate с TTL 1 ч (ТЗ 4.10)
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req)
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res.ok) {
              cache.put(req, res.clone()).catch(() => {})
            }
            return res
          })
          .catch(() => cached || Response.error())
        if (cached) {
          // проверяем TTL по заголовку времени кэширования
          const ts = cached.headers.get('sw-cached-at')
          if (ts && Date.now() - Number(ts) > API_TTL_MS) {
            return fetchPromise
          }
          event.waitUntil(fetchPromise.catch(() => {}))
          // клонируем с обновлённым заголовком времени, если его нет
          if (!ts) {
            const headers = new Headers(cached.headers)
            headers.set('sw-cached-at', String(Date.now()))
            const body = await cached.clone().arrayBuffer()
            return new Response(body, { status: cached.status, headers })
          }
          return cached
        }
        return fetchPromise
      }),
    )
    return
  }

  // Прочая статика: network-first с fallback на кэш (офлайн-оболочка).
  // cache-first только для стабильных ресурсов, чтобы не устаревать чанки dev-сборки.
  if (url.origin === self.location.origin) {
    const stable = PRECACHE.some((p) => url.pathname === p) || url.pathname.startsWith('/icons/')
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (stable || req.destination === 'image')) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/').then((shell) => shell || Response.error())),
        ),
    )
  }
})
