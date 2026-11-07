'use client'

/**
 * История расчётов: IndexedDB (офлайн) + синхронизация с сервером,
 * анонимный device_id, фильтры, экспорт JSON/CSV/PDF, загрузка записи.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRadioStore } from '@/store/radio-store'
import { linkStatus } from '@/lib/radio/budget'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getDeviceId, listHistory, clearHistory, syncPending, fetchServerHistory } from '@/lib/radio/history'
import { download, toJson, historyToCsv } from '@/lib/radio/export'
import { historyEntriesToPdfBlob } from '@/lib/radio/pdf'
import type { HistoryEntry } from '@/lib/radio/types'
import { History, RefreshCw, Trash2, FileJson, FileSpreadsheet, FileText, CloudUpload } from 'lucide-react'

export function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [serverEntries, setServerEntries] = useState<HistoryEntry[]>([])
  const [filterModel, setFilterModel] = useState<string>('all')
  const [filterBackend, setFilterBackend] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [syncInfo, setSyncInfo] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const calculate = useRadioStore((s) => s.calculate)

  useEffect(() => {
    const t = setTimeout(() => setDeviceId(getDeviceId()), 0)
    return () => clearTimeout(t)
  }, [])

  const refresh = useCallback(async () => {
    if (!deviceId) return
    const local = await listHistory(deviceId)
    setEntries(local)
    const server = await fetchServerHistory(deviceId)
    setServerEntries(server)
  }, [deviceId])

  useEffect(() => {
    void Promise.resolve().then(refresh)
  }, [refresh])

  const merged = [...entries]
  const filtered = merged.filter((e) => {
    if (filterModel !== 'all' && e.model !== filterModel) return false
    if (filterBackend !== 'all' && e.backend !== filterBackend) return false
    if (dateFrom && e.createdAt < dateFrom) return false
    return true
  })

  const doSync = async () => {
    setSyncInfo('Синхронизация…')
    const r = await syncPending(deviceId)
    const server = await fetchServerHistory(deviceId)
    setServerEntries(server)
    await refresh()
    setSyncInfo(`Отправлено: ${r.ok}, ошибок: ${r.fail}${server.length > 0 ? `, на сервере: ${server.length}` : ''}`)
  }

  const loadEntry = (e: HistoryEntry) => {
    // Восстановление входных данных расчёта в форму
    const s = useRadioStore.getState()
    const inp = e.input
    s.setPointA(inp.path.points[0])
    s.setPointB(inp.path.points[1])
    s.setField('frequencyMhz', inp.frequencyMhz)
    s.setField('polarization', inp.polarization)
    s.setField('txHeightM', inp.txHeightM)
    s.setField('rxHeightM', inp.rxHeightM)
    s.setField('kFactor', inp.kFactor)
    s.setField('climateZone', inp.climateZone)
    s.setAtmosphere(inp.atmosphere)
    // Полное восстановление параметров линка: частотные режимы обеих станций
    // и оборудование (в старых записях снимка нет — остаётся текущее состояние)
    const lp = e.linkParams
    if (lp) {
      s.setField('frequencyMode', lp.frequencyMode)
      s.setField('freqFromMhz', lp.freqFromMhz)
      s.setField('freqToMhz', lp.freqToMhz)
      s.setField('mobileFrequencyMhz', lp.mobileFrequencyMhz)
      s.setField('mobileFrequencyMode', lp.mobileFrequencyMode)
      s.setField('mobileFreqFromMhz', lp.mobileFreqFromMhz)
      s.setField('mobileFreqToMhz', lp.mobileFreqToMhz)
      s.setEquipment(lp.equipment)
    }
    // Модель распространения — часть настройки расчёта
    s.setField('model', e.model)
    void calculate()
  }

  /** Экспорт записей в PDF: по листу на расчёт. */
  const exportPdf = async (entries: HistoryEntry[], single?: boolean) => {
    if (entries.length === 0) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const blob = await historyEntriesToPdfBlob(entries)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      a.href = url
      a.download = single
        ? `расчёт-${entries[0].createdAt.slice(0, 19).replace(/[T:]/g, '-')}.pdf`
        : `история-расчётов-${stamp}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setPdfError(`Не удалось сформировать PDF: ${err instanceof Error ? err.message : err}`)
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-600" /> История расчётов
            <Badge variant="outline" className="font-mono text-xs">device_id: {deviceId ? deviceId.slice(0, 8) + '…' : '…'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Модель</Label>
              <Select value={filterModel} onValueChange={setFilterModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="p2001">P.2001</SelectItem>
                  <SelectItem value="fspl-p526">FSPL + P.526</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Бэкенд</Label>
              <Select value={filterBackend} onValueChange={setFilterBackend}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="wasm">wasm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">С даты</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" variant="outline" onClick={() => void doSync()}>
                <CloudUpload className="h-4 w-4 mr-1" /> Синхронизировать
              </Button>
            </div>
          </div>
          {syncInfo && <p className="text-xs text-muted-foreground">{syncInfo}</p>}

          {/* Нативная прокрутка: Radix ScrollArea с max-h не ограничивает высоту —
              таблица вылезала за карточку (см. баг-репорт). */}
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead>Модель</TableHead>
                  <TableHead className="text-right">Частота, МГц</TableHead>
                  <TableHead className="text-right">Длина, км</TableHead>
                  <TableHead className="text-right">Потери, дБ</TableHead>
                  <TableHead className="text-right">Запас, дБ</TableHead>
                  <TableHead>Синхр.</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                      Расчётов пока нет. Выполните расчёт — он сохранится локально (IndexedDB) и синхронизируется с сервером.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((e) => (
                  <TableRow key={`${e.id}-${e.createdAt}`}>
                    <TableCell className="text-xs">{new Date(e.createdAt).toLocaleString('ru-RU')}</TableCell>
                    <TableCell className="text-xs">{e.name}</TableCell>
                    <TableCell className="text-xs">{e.model === 'p2001' ? 'P.2001' : 'FSPL+P.526'}</TableCell>
                    <TableCell className="text-right text-xs font-mono">{e.frequencyMhz} МГц</TableCell>
                    <TableCell className="text-right text-xs font-mono">{e.distanceKm.toFixed(1)} км</TableCell>
                    <TableCell className="text-right text-xs font-mono">{e.medianLossDb.toFixed(1)} дБ</TableCell>
                    <TableCell className={`text-right text-xs font-mono ${linkStatus(e.linkMarginDb) === 'stable' ? 'text-emerald-600' : linkStatus(e.linkMarginDb) === 'marginal' ? 'text-amber-600' : 'text-destructive'}`}>
                      {e.linkMarginDb.toFixed(1)} дБ
                    </TableCell>
                    <TableCell className="text-xs">{e.synced ? '✓' : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => loadEntry(e)} title="Загрузить в форму">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Экспорт JSON"
                          onClick={() => download(`история-${e.createdAt.slice(0, 19)}.json`, toJson(e), 'application/json')}
                        >
                          <FileJson className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Экспорт PDF (лист на расчёт)"
                          onClick={() => void exportPdf([e], true)}
                          disabled={pdfBusy}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Удалить запись"
                          onClick={() => {
                            void clearHistory(deviceId).then(refresh)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => download('история-расчётов.json', toJson({ entries: filtered }), 'application/json')}
            >
              <FileJson className="h-4 w-4 mr-1" /> Экспорт JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download('история-расчётов.csv', historyToCsv(filtered), 'text/csv')}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Экспорт CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportPdf(filtered)} disabled={pdfBusy || filtered.length === 0}>
              <FileText className="h-4 w-4 mr-1" />
              {pdfBusy ? 'Формирование PDF…' : 'Экспорт PDF'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void clearHistory(deviceId).then(refresh)}>
              <Trash2 className="h-4 w-4 mr-1" /> Очистить историю
            </Button>
            {serverEntries.length > 0 && (
              <p className="text-xs text-muted-foreground self-center">На сервере: {serverEntries.length} записей</p>
            )}
          </div>
          {pdfError && <p className="text-xs text-destructive">{pdfError}</p>}
          <p className="text-xs text-muted-foreground">
            Экспорт PDF: каждый лист содержит основные данные расчёта — частоту, координаты приёмника и передатчика,
            длину трассы, профиль рельефа с основными линиями (рельеф, прямая видимость, зона Френеля)
            и данные по радиосвязи (бюджет линии).
          </p>
          <p className="text-xs text-muted-foreground">
            При недоступности сервера история ведётся только в IndexedDB (офлайн-fallback). Авторизация не требуется —
            привязка к анонимному device_id.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
