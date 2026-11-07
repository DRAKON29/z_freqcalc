# AGENTS.md — контекст проекта z_freqcalc

Файл для работы ИИ-агентов в новых сессиях/потоках. Прочитай его перед началом работы.
Общение с пользователем — на русском (неформальный регистр). Этот файл — операционный
контекст; подробная документация по функциональности — в [README.md](README.md).

## Что это

Калькулятор распространения радиоволн «точка–точка / точка–подвижный объект»,
500–7000 МГц, по ТЗ v1.0 (само ТЗ — `upload/tz.pdf`). PWA: Next.js 16 + React 19 + TS
(bun), гибридный бэкенд — три модели за интерфейсом `PropagationModel`
(`src/lib/radio/models/`):

- **Http** → FastAPI-микросервис `mini-services/radio-service/` (движок py: P.2001-lite)
- **Wasm** → тот же `p2001_lite.py` через Pyodide в браузере
- **Local** → TS-fallback FSPL + P.526 (fallback при недоступности сервиса, с warning)

Государство — zustand (`src/store/radio-store.ts`), ядро расчётов — `src/lib/radio/*`
(P.525/526/837/838/676/833, бюджет, доплер, координаты WGS84↔СК-42, рельеф SRTM/GLO-30,
SXF→clutter, история IndexedDB+сервер).

## Окружение машины (Windows, Git Bash)

- bun 1.4.3, Python 3.15.0 (venv: `mini-services/radio-service/.venv`,
  питон — `./.venv/Scripts/python.exe`)
- gh CLI авторизован (аккаунт DRAKON29, https), но в PATH оболочки ZCode его нет —
  звать по полному пути `/c/Program Files/GitHub CLI/gh.exe`
- Оболочка после каждой команды возвращается в workspace сессии — рабочую папку
  репо указывать в каждой команде (`cd /d/projects/glm_calc/z_freqcalc && …`)

## Запуск локально (порты 3000 фронт / 8000 сервис)

```bash
# 1. Python-сервис
cd mini-services/radio-service
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# 2. Фронт (из корня репо) — обязательно с API_BASE, иначе /api/* уйдёт в Next (404)
#    и http-модель молча уйдёт в TS-fallback
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api bun run dev
```

Шлюз `?XTransformPort=8000` в `src/lib/radio/models/api.ts` — конвенция песочницы z.ai,
локально не работает; вне песочницы нужен `NEXT_PUBLIC_API_BASE` (описано в README).

## Верификация (регресс)

```bash
bun test tests/          # 72 теста TS-ядра — должны быть зелёными
bun run lint             # eslint — чисто
cd mini-services/radio-service && ./.venv/Scripts/python.exe -m pytest tests/ -q   # 25 тестов формул
```

Контрольные значения на дефолтных вводных (Москва A→Б, 2400 МГц, P.2001, http):
медианные потери **173.0 дБ**, P_rx **−132.7 дБм**, margin **−31.3 дБ**
(линия не обеспечивается — это норма для NLOS на синтетическом DEM; P_rx и margin
включают потери наведения 2×1.3 дБ по ширине луча 30° и номинальном отклонении 10°).

## Состояние (2026-11-07)

Ветка разработки — **`dev_`** (не main; main = исходный клон). Remote: `origin`,
тег `init_tag` стоит на `6b9ae47` (устарел относительно HEAD). Коммиты — conventional
на русском, пушим в `dev_`.

**Не закоммичено**: загрузка траектории из файла на вкладке «Динамика» —
`src/lib/radio/route.ts` (парсер `parseRouteFile` + `routeStateAt`/`routeDurationS` с
кэшем сегментов), `routeFileSchema` в validation.ts (минимум 4 точки, любое
расширение файла), маршрутная ветка в `simulateDynamics`/`trajectoryPoints`
(doppler.ts, 4-й аргумент `route?`), store (`route`, `loadRoute`, `clearRoute`;
`tripodHeight` файла → `txHeightM`), UI-блок в DynamicsPanel, полилиния+анимация по
маршруту в MapPanel, тесты `tests/route.test.ts` + фикстура `tests/fixtures/route-sample.rt`
(72 теста). Попутный фикс гонки fitBounds в MapPanel: оба fitBounds (трасса и
траектория) — `animate: false`, иначе отложенная zoom-анимация трассы при
перемонтировании вкладки перебивала вид на маршрут.

Реализовано в этой сессии (сверху вниз):
- `32fab51` — режим частоты подвижного (свой переключатель «одна частота / диапазон»,
  развёртка обратной линии до 12 точек с обменом оборудования, карточка развёртки
  в результатах); перенос функционала из `web_dev_z` (ручной merge): цифровые
  продукты ITU-R P.2001-6 (Table 3) автоматически участвуют в расчёте p2001-lite
  (k из DN_Median по P.453, дождь CCDF P.837-6 из Esarain, ρ из Surfwv_50_fixed,
  зона TropoClim, диагноз Es-слоя по FoEs), продукты берутся из кэша браузера
  (IndexedDB, `loadItuMaps()` на монте) независимо от сервера; таблица статусов
  продуктов в «Картах»; круговая диаграмма зоны покрытия (`coverage.ts` +
  `CoveragePanel`, монтируется в результатах); карточка «Условия из цифровых
  продуктов ITU» в результатах; фикс прокрутки таблицы истории (нативный
  overflow + липкая шапка)
- `0f2f79e` — частоты по станциям (`mobileFrequencyMhz` в store) + **обратная линия**
  (подвижный Tx → наземный Rx на своей частоте; в режиме «диапазон» и при равных
  частотах не считается — в ResultsPanel пояснение); секция обратной линии в результатах
- `d280ff6` — приёмо-передатчики разделены: карточки «Наземный (Tx)» / «Подвижный (Rx)»
  (высота антенны + антенна + передатчик/приёмник в каждой), общие условия линии —
  карточка «Условия распространения». Цветовой код: **emerald = Tx/наземный,
  amber = Rx/подвижный**. Подвижный в статике = Rx в точке Б (текущая позиция объекта)
- `5966e35` — удалён скэфолд песочницы (Prisma, z-ai-web-dev-sdk, hello-route)
- `766cd43` — .gitignore рантайм-артефактов; из репо убраны history.db, db/custom.db, dev.pid
- `c8f3782` — `mini-services/radio-service/requirements.txt` (fastapi/uvicorn/
  python-multipart зафиксированы; без python-multipart сервис не стартует), CI из него
- `17ccdf1` — README: закрыт merge-конфликт, раздел «Локально (вне песочницы)»
- `6b9ae47` — сворачиваемые секции на вкладке «Карты и настройки» (все свёрнуты по умолчанию)
- `cd527bf` — валидация карт ITU: принимаются числовые сетки официальных таблиц
  ITU-R P.2001-6 без заголовка (DN_Median, Esarain_*, FoEs*, TropoClim, h0, surfwv) +
  мульти-загрузка за один запрос (`{uploaded, failed}`)

## Известные ограничения / незакрытое

1. **py2001 (python) карты не читает**: TS-модель p2001lite цифровые продукты ITU
   уже использует (кэш браузера, поле `environment` в input), а python-сервис их
   игнорирует. Точка расширения — `api_calculate` в `main.py` (блок
   `if model == "p2001" and _py2001_available()`: сейчас поднимает «требуется
   адаптер карт»). Полный набор таблиц лежит у пользователя в `D:\itu\P_2001-6`.
2. **Обратная линия не попадает** в историю (IndexedDB/сервер), PDF-экспорт и
   JSON/CSV — там только прямая. Сами расчёты обратной линии в любой комбинации
   режимов частоты (одна/диапазон у каждой станции) работают с `32fab51`.
3. **Динамика**: маршрут из файла считает только прямую линию связи (Tx = точка A,
   рельеф не учитывается — FSPL по наклонной дальности); борт в ручном режиме
   стартует над точкой A. runDynamics берёт параметры из equipment (tx-мощность,
   rx-чувствительность), а не из стационарного расчёта; обратная линия в динамике
   не считается. Маршрут не попадает в историю/PDF/экспорты.
4. **P.528** не реализована (решение по ТЗ 9.3: подключать только если сравнительные
   тесты дадут >5% выигрыша; точка интеграции — пакет p528 в http-режиме).
5. `MapPanel`/ResultsPanel не показывают обратную линию на карте/профиле (только сводка и бюджет).
6. История коммитов до `cd527bf` содержит GUID-имена и merge-мусор — не переписывать (запушено).

## Заметки по автоматизации UI (браузерные проверки)

- В IAB-сборке через Playwright-локаторы могут не кликаться не только вкладки Radix,
  но и свитчи и обычные кнопки (таймаут actionability) — надёжнее dispatch
  последовательности `pointerdown/mousedown/pointerup/mouseup/click` через
  `playwright.evaluate` (Radix активирует вкладку на mousedown, простой `.click()`
  не работает). Реакция React на dispatch асинхронная — состояние проверять с
  задержкой, не сразу.
- Значения React-инпутов менять через native setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) + `input` event.
- Файл-аплоуд в IAB-браузере не автоматизируется — проверять загрузку curl'ом
  (`POST /api/maps/upload`, поле `files`); для проверки «карта → расчёт» можно
  вписать продукт напрямую в IndexedDB (`radio-propagation`, store `itu_maps`,
  записи `{name, text}`) и перезагрузить страницу.

## Ключевые файлы

| Путь | Что |
|---|---|
| `src/store/radio-store.ts` | всё состояние: ввод, equipment, atmosphere, ituGrids, результаты (result/budget/reverse*/reverseRange*), dynamics, `buildInput()`, `calculate()` |
| `src/lib/radio/types.ts` | `CalculationInput`, `EquipmentParams`, `PropagationResult`, `LinkBudget`, `ItuEnvironmentData` |
| `src/lib/radio/budget.ts` | `computeLinkBudget(input, equipment, prop, extra)` — приход/расход, EIRP, SNR, margin |
| `src/lib/radio/p2001lite.ts` | TS-модель (fallback), `computeP2001Lite`, `computeFsplP526`; читает `input.environment` (продукты ITU) |
| `src/lib/radio/itu-grid.ts` | парсер/валидатор сеток ITU-R P.2001-6 (Table 3): 121×241, 161×321, 360×720, спецификации продуктов |
| `src/lib/radio/itu-env.ts` | `ITU_PRODUCTS`, `ituEnvironmentAt()` — извлечение условий в точках трассы (билинейная интерполяция P.1144) |
| `src/lib/radio/coverage.ts` + `src/components/radio/CoveragePanel.tsx` | круговая диаграмма зоны покрытия: граница связи по азимутам с учётом рельефа, канва с гипсометрией |
| `src/lib/radio/route.ts` | файл траектории: `parseRouteFile` (JSON → zod), сегментация с кэшем (WeakMap), `routeStateAt(route, t)` — позиция/высота/скорость/вертикальная скорость в момент t, `routeDurationS` |
| `mini-services/radio-service/main.py` | FastAPI: `/api/calculate`, `/api/maps/*`, `/api/clutter`, `/api/history`, `/api/dem`; валидация карт (`_looks_like_numeric_grid`) |
| `mini-services/radio-service/p2001_lite.py` | P.2001-lite + бюджет (python) |
| `src/components/radio/` | панели: Input, Equipment, Results, Dynamics, History, Maps, Map, Coverage, Pwa |
| `src/app/page.tsx` | вкладки Расчёт/Динамика/История/Карты, порядок панелей, `loadItuMaps()` на монте |
| `deploy/` | docker-compose http/wasm, openresty |
