'use client'

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Регистрация Service Worker (ТЗ 4.10). */
export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((e) => console.warn('SW registration failed:', e))
    }
  }, [])
  return null
}

/** Баннер «Установить приложение» (beforeinstallprompt, ТЗ 4.10). */
export function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!deferred || hidden) return null

  return (
    <div className="mx-4 mb-2 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800 p-3 flex items-center justify-between gap-3">
      <p className="text-sm text-emerald-800 dark:text-emerald-200">
        Установите приложение на главный экран — доступен офлайн-режим с историей расчётов.
      </p>
      <div className="flex gap-2 shrink-0">
        <button
          className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-3 py-1.5"
          onClick={() => {
            void deferred.prompt()
            setDeferred(null)
          }}
        >
          Установить
        </button>
        <button
          className="text-sm text-muted-foreground hover:text-foreground px-2"
          onClick={() => setHidden(true)}
          aria-label="Скрыть"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
