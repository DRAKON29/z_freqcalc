'use client'

/**
 * Калькулятор распространения радиоволн (ТЗ v1.0).
 * Одностраничное приложение с вкладками: Расчёт, Динамика, История, Карты.
 */
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRadioStore } from '@/store/radio-store'
import { InputPanel } from '@/components/radio/InputPanel'
import { EquipmentPanel } from '@/components/radio/EquipmentPanel'
import { ResultsPanel } from '@/components/radio/ResultsPanel'
import { DynamicsPanel } from '@/components/radio/DynamicsPanel'
import { HistoryPanel } from '@/components/radio/HistoryPanel'
import { MapsPanel } from '@/components/radio/MapsPanel'
import { PwaRegister, InstallBanner } from '@/components/radio/Pwa'
import { Waves, Radar, Plane, History, Map } from 'lucide-react'

const MapPanel = dynamic(() => import('@/components/radio/MapPanel').then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <div className="h-[420px] rounded-lg border bg-muted animate-pulse" />,
})

export default function Home() {
  const calculate = useRadioStore((s) => s.calculate)
  const calculating = useRadioStore((s) => s.calculating)
  const lastError = useRadioStore((s) => s.lastError)
  const backend = useRadioStore((s) => s.backend)
  const backendAvailable = useRadioStore((s) => s.backendAvailable)
  const checkBackend = useRadioStore((s) => s.checkBackend)
  const [tab, setTab] = useState('calc')

  useEffect(() => {
    void checkBackend()
  }, [checkBackend])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PwaRegister />

      {/* Шапка */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Radar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Калькулятор распространения радиоволн</h1>
              <p className="text-xs text-muted-foreground">
                500–7000 МГц · ITU-R P.2001 / FSPL + P.526 · PWA
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={backendAvailable === false ? 'destructive' : 'secondary'}
              className="font-mono text-xs"
              title="Индикатор активного бэкенда (ТЗ 4.2.3)"
            >
              {backend === 'http' ? `http${backendAvailable === false ? ' · офлайн' : ''}` : 'wasm · Pyodide'}
            </Badge>
          </div>
        </div>
      </header>

      <InstallBanner />

      {/* Основное содержимое */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 flex-wrap h-auto">
            <TabsTrigger value="calc" className="gap-1">
              <Waves className="h-4 w-4" /> Расчёт
            </TabsTrigger>
            <TabsTrigger value="dynamics" className="gap-1">
              <Plane className="h-4 w-4" /> Динамика
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1">
              <History className="h-4 w-4" /> История
            </TabsTrigger>
            <TabsTrigger value="maps" className="gap-1">
              <Map className="h-4 w-4" /> Карты и настройки
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calc" className="space-y-4">
            <MapPanel />
            <InputPanel />
            <EquipmentPanel />

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void calculate()} disabled={calculating} className="bg-emerald-600 hover:bg-emerald-700">
                {calculating ? 'Расчёт…' : 'Рассчитать'}
              </Button>
              {lastError && <span className="text-sm text-destructive">{lastError}</span>}
            </div>

            <ResultsPanel />
          </TabsContent>

          <TabsContent value="dynamics">
            <DynamicsPanel />
          </TabsContent>

          <TabsContent value="history">
            <HistoryPanel />
          </TabsContent>

          <TabsContent value="maps">
            <MapsPanel />
          </TabsContent>
        </Tabs>
      </main>

      {/* Подвал */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <p>ITU-R P.2001/P.525/P.526/P.537·P.838/P.676/P.833 · СК-42 (Гаусс–Крюгер) · Copernicus GLO-30 / SRTM</p>
          <p>Веб-приложение по ТЗ v1.0 · офлайн-режим PWA</p>
        </div>
      </footer>
    </div>
  )
}
