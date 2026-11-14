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
bun test tests/          # 171 тест TS-ядра — должны быть зелёными
bun run lint             # eslint — чисто
cd mini-services/radio-service && ./.venv/Scripts/python.exe -m pytest tests/ -q   # 68 тестов + 1 skip (эталонная валидация P.452 ждёт карты ITU)
```

E2E (стек уже запущен: сервис :8000 + фронт :3000):
`PLAYWRIGHT_CHANNEL=msedge bunx playwright test` (23 сценария: 6 — e2e/ux.spec.ts этап UX,
1 — помехи C/I, 1 — покрытие на карте, + fullscreen/пресеты).

Контрольные значения на дефолтных вводных (Москва A→Б, 2400 МГц, P.2001, http):
медианные потери **173.0 дБ**, P_rx **−132.7 дБм**, margin **−31.3 дБ**
(линия не обеспечивается — это норма для NLOS на синтетическом DEM; P_rx и margin
включают потери наведения 2×1.3 дБ по ширине луча 30° и номинальном отклонении 10°).

## Состояние (2026-11-08, актуализировано в `a0422b4`+)

Ветка разработки — **`dev_`** (не main; main = исходный клон). Remote: `origin`, HEAD — см.
git log; **локальные коммиты (обзор конкурентов, этап UX) НЕ запушены — регламент пользователя:
пуш только по явной команде**; прод calc.drakonlab.ru пока на `075f1a3` (CI запустится при пуше).
Тег **`допфункционал`** — зафиксированное состояние перед этапом UX (push тега CI не триггерит).
Тег `init_tag` стоит на `6b9ae47`
(устарел относительно HEAD). Коммиты — conventional на русском, пушим в `dev_`.

Реализовано (сверху вниз):
- (этот коммит) **роадмап 2.5 — покрытие на карте**: computeCoverage сохраняет
  уровни по контрольной сетке 72×60 (CoverageResult.levels, Float32Array, NaN за
  границей в геометрических режимах); новый src/lib/radio/map-coverage.ts —
  coverageBounds (плоская проекция 111320/cosLat), marginAt (билинейная
  интерполяция с wrap по азимуту), coverageColorAt (4 зоны по margin,
  согласованы с tri-color), renderCoverageOverlay (offscreen-canvas 512×512 →
  toDataURL); CoveragePanel после расчёта строит оверлей и кладёт в store
  (mapCoverage + автопоказ mapCoverageVisible=true); MapPanel — imageOverlay
  (remove/create, opacity без пересоздания), тумблер «Покрытие на карте» +
  слайдер непрозрачности + бейдж «покрыто N % · макс X км». Грабли: modes
  geometry/fresnel не пишут margins (NaN — рендер по границам радиалов через
  boundaryColorAt). Тесты: 171 TS (+11 coverage-map), 23 E2E (+1)
- (этот коммит) **роадмап 2.3 — интерференция C/I (P.452 + P.372)**:
  вендоренный порт Py452 (ITU-R P.452-18, `mini-services/radio-service/p452_port/`,
  лицензия допускает вендоринг; изменения — загрузка npz из env RADIO_P452_NPZ
  = `<DATA_DIR>/p452/P452.npz`, переименование пакета; карты N050/DN50 не
  распространяются — `scripts/download_p452_maps.ps1` + `scripts/build_p452_npz.py`,
  без npz импорт падает = «P.452 недоступен»); `POST /api/interference` (пути с
  готовыми профилями от клиента, p=[50,1], зона 1/2/3, Gt/Gr=0 — усиления на клиенте;
  ключ p452 в capabilities/health); TS `src/lib/radio/interference.ts`:
  `computeInterferencePathLosses` (http + честный фоллбек P.2001-lite медианой 50 %
  с предупреждением), чистые `buildInterferenceReport`/`interferenceLevel`/
  `discriminationAngleDeg`/`interferenceImpact` — I = EIRP_пом − L_P452 + G_жертвы −
  pointingLoss(угол луч/помеха), I/N, C/I vs C/I_min (дефолт = Eb/N0 приёмника),
  C/(N+I) = SNR − Δ, Δ = 10lg(1+I/N), классы влияния <0.5/<1/<3 дБ; store: поля
  interference* + расчёт в calculate() после бюджетов (подкачка тайлов путей помехи,
  жертвы: Rx в точке Б — прямая, Rx в точке A — обратная, антенна жертвы eq.rx/eq.tx);
  UI: чекбокс + CoordEditor('C') + поля в «Трассе», режим клика «Клик → помеха» +
  перетаскиваемый красный маркер C, карточка «Помехи (C/I, ITU-R P.452)» с таблицей
  50 %/1 % и `<details>` деталей + компактный блок в обратной линии. pytest
  test_p452.py: dispatch на синтетическом npz (121×241 константы, CI всегда) +
  эталонная валидация SG3 (skip без реальных карт, tol ±0.1 дБ). Грабли: селектор
  zustand с inline-стрелкой для 'C' давал бесконечный ре-рендер (getSnapshot
  некэшируем) — пишется через setField вне селектора. Тесты: 160 TS (+10), 22 E2E (+1)
- `8e1fd39`+`cd32c54` **этап UX (UX.1–UX.6, референс antenna.2tg.dev, тег `допфункционал` — точка отсчёта)**:
  UX.1 share-ссылка (`src/lib/radio/share.ts` — encode/decode URL-hash с zod-валидацией,
  tolerant; кнопка «Поделиться» в page.tsx, clipboard+toast; декод на монте + autorun `run=1`;
  store-действие `applyShareState`; НЕ сериализуются карты/тайлы/clutter/маршрут);
  UX.2 пользовательские пресеты оборудования (`src/lib/radio/presets.ts` — localStorage
  `radio-presets`, merge/replace, JSON-файл v1; StationCard: «Сохранить пресет как…»
  (Dialog) + селектор применения к любой станции; MapsPanel: секция «Пресеты оборудования»
  — экспорт/импорт с двумя режимами и красным предупреждением перезаписи; store:
  `presets`/`savePreset`/`deletePreset`/`importPresets`); UX.3 режимы преград покрытия
  (`computeFsplP526(input, opts?: {skipDiffraction})` аддитивно; `computeCoverage({mode})`:
  model/fspl/geometry/fresnel, геометрическая классификация через
  `worstClearanceRatio` (LOS/0.6·F1, непрерывная зона от центра); store `coverageMode`;
  CoveragePanel: селектор с честными подписями, адаптивная легенда); UX.4 drag маркеров
  A/Б (персистентные инстансы вместо recreate, dragend → setPointA/B, без автопересчёта);
  UX.5 fullscreen карты (CSS fixed inset-0, invalidateSize, Escape); UX.6 mesh-заготовка
  (`src/lib/radio/mesh.ts` — типы + `evaluateMeshChain` бросает исключение; п. 2.4 заморожен,
  UI нет). Тесты: 150 TS (+23: share 8, presets 9, coverage-modes 5, mesh 1), 21 E2E (+6
  e2e/ux.spec.ts); drag проверен в браузере (IAB cua.drag → точка A изменилась)
- `075f1a3` fix(ui): однозначные подписи направления в блоках Передатчик/Приёмник карточек станций
- (этот коммит) **роадмап 2.1 — Longley-Rice ITM ('itm')**: вендоренный порт ITM
  v1.2.2 (AB3AP, public domain NTIA/ITS) в itm_port.py + адаптер itm_model.py
  (climate=5, N0=301, epsR/sigma из input, zT=Φ⁻¹(p/100)); dispatch elif model=="itm"
  в /api/calculate (ранее неизвестные модели молча попадали в fspl-p526!) +
  capabilities; ModelId + 'itm' в TS с явным fallback на P.2001-lite
  (http-fallback/wasm) и предупреждением; селектор в EquipmentPanel, фильтр и
  метка в HistoryPanel, optimal-point: itm→P.2001-lite; стор: comparison
  (ModelComparison) — перекрёстный расчёт P.2001 при выбранном ITM; карточка
  «Сравнение моделей: ITM vs P.2001» в ResultsPanel; requirements.txt +numpy==2.5.4;
  TS-gap задокументирован (README); pytest test_itm.py (8, эталоны на синтетике)
- `57ed2ff` **роадмап 2.2 — UAV-динамика**: рельеф per-sample в simulateDynamics
  (медианная цепочка через medianMechanismsLossDb — единый источник с computeFsplP526;
  FSPL по наклонной дальности, профиль дифракции по земле; растительность исключена);
  ДН по углу места (ошибка = |el(t) − initialElevationDeg|, поле добавлено в UI;
  omni — без наведения); скорости 0–300 км/ч (LIMITS); requiredTilesForPolyline +
  fetchMissingSrtmTiles(points?) — автоподкачка тайлов вдоль траектории;
  runDynamics асинхронный с прогрессом (dynamicsProgress); simulateDynamics async
  с уступками потока; известное ограничение №3 снято (остались: обратная линия
  в динамике не считается; маршрут не в истории/PDF/экспортах)
- `535a7fb` **диаграммы поиска позиции A + чистка покрытия**: слой карты
  убран из круговой диаграммы (только рельеф); отрисовка вынесена в общий
  `CoverageDiagram.tsx` (масштабируемые размеры); новый `CoveragePreview.tsx` —
  предпросмотр покрытия от кандидатной позиции (HoverCard по пиктограмме в
  таблице кандидатов, кэш, шаг 10°, сетка 80×80); кнопка «Применить» переносит
  точку A в кандидата и пересчитывает
- `efd4e11` **поиск оптимальной позиции точки A**: чекбокс «Поиск позиции» +
  «Радиус поиска, м» ≤ 5000 (InputPanel); `src/lib/radio/optimal-point.ts` —
  61 кандидат (кольца 0.25R–R, 8/12/16/24 азимута), полная оценка линии каждой
  позиции с параметрами выполненного расчёта (меняется только позиция A),
  локальная TS-модель для скорости; store: searchEnabled/searchRadiusM/
  searchReport/searchProgress (запуск в calculate после основной линии);
  ResultsPanel: сворачиваемый блок «найдено N оптимальных точек» (N — лучше
  исходной по margin), таблица СК-42 X/Y по 7 цифр (fmtSk42SevenDigits,
  Y с зоной), запас/P_rx/потери/удаление
- 1.3 (`4347462`): сравнение методов дифракции — Эпштейн–Петерсон
  (P.526 §4.5.1) в `diffraction.ts` + `diffractionMethodsDb` (развертка
  Буллингтон/Дейгаут/ЭП, текущая max(Д,Б), разброс); раскрывающаяся таблица
  в карточке профиля (при дифракции > 0.05 дБ); python-зеркало
  `epstein_peterson_loss_db` (p2001_lite.py) + `diffraction_methods_db` (reports.py)
- `9ead9e4` — **роадмап 1.4**: шумовой порог P.372-17 (`src/lib/radio/noise.ts`):
  селектор «Шумовое окружение» в приёмнике (дефолт «не учитывать» — бюджет не
  меняется; фиты Table 1 валидны 0.3–250 МГц, выше зажим на 0 дБ), N = kTB +
  10lg(f_rx + f_a − 1), python-зеркало в compute_budget
- `60d5801` — **роадмап 1.2**: clearance-аудит (`src/lib/radio/clearance.ts`):
  просвет 0.6·F1 при K = 4/3, 2/3, ∞, класс «лёгкая/тяжёлая трасса», доп. потери
  подрефракции; блок в карточке профиля + бейдж на карте; python-зеркало в reports.py
- `8a7ff7d` — **роадмап 1.1**: availability-отчёт P.530-19 (`src/lib/radio/availability.ts`):
  недоступность ч/год (многолучёвость p₀·10^(−FM/10) + дождь с path reduction
  factor d0 = 35·e^(−0.015·R0.01) и интерполяцией A(p)), цели 99.5/99.9/99.99 %;
  карточка в результатах, строка в расходе бюджета, секция в JSON/CSV; R0.01 —
  карты ITU → ввод → зона дождя (RAIN_ZONE_R001_MMH, P.837-3); python-зеркало
  `reports.py` (отчёт клиентский для любого движка, формулы проверяются в обоих);
  p0 вынесен из p2001lite в `multipathOccurrenceFactor`, rainLossDb получил opts.d0Km
- `be44163` — data/srtm (локальный кэш тайлов) в .gitignore
- `8c8ff2a` — ROADMAP.md: план развития (анализ предметной области, gap-анализ, этапы)
- `00a60e3` — деплой-джоба внутри CI вместо workflow_run
- `9ce55bd` — httpx2 для fastapi TestClient в тестах API
- `f0e55f1` — CI/CD «как Vercel»: сборка и E2E на GitHub, сервер только принимает образы
- `6cdf763` — автоподкачка тайлов трассы с сервера в IndexedDB
- `410bf0d` — раздача тайлов SRTM с сервера (GET /api/srtm)
- `9dc9067` — загрузка траектории из файла на вкладке «Динамика»: `src/lib/radio/route.ts`
  (парсер `parseRouteFile` + `routeStateAt`/`routeDurationS` с кэшем сегментов),
  `routeFileSchema` в validation.ts (минимум 4 точки, любое расширение файла),
  маршрутная ветка в `simulateDynamics`/`trajectoryPoints` (4-й аргумент `route?`),
  store (`route`, `loadRoute`, `clearRoute`; `tripodHeight` файла → `txHeightM`),
  UI-блок в DynamicsPanel, полилиния+анимация по маршруту в MapPanel, тесты
  `tests/route.test.ts` + фикстура `tests/fixtures/route-sample.rt`. Попутный фикс
  гонки fitBounds в MapPanel: оба fitBounds (трасса и траектория) — `animate: false`,
  иначе отложенная zoom-анимация трассы при перемонтировании вкладки перебивала
  вид на маршрут
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
3. **Динамика**: обратная линия в динамике не считается; маршрут не попадает
   в историю/PDF/экспорты. (Рельеф per-sample, ДН по углу места и 0–300 км/ч
   реализованы в 2.2.)
4. **P.528** не реализована (решение по ТЗ 9.3: подключать только если сравнительные
   тесты дадут >5% выигрыш; точка интеграции — пакет p528 в http-режиме).
5. `MapPanel`/ResultsPanel не показывают обратную линию на карте/профиле (только сводка и бюджет).
6. История коммитов до `cd527bf` содержит GUID-имена и merge-мусор — не переписывать (запушено).
7. **Помеха C/I (2.3) не попадает** в историю (IndexedDB/сервер) и PDF/JSON/CSV —
   только карточка результатов. Допущения помехи: ко-канальная (полное спектральное
   перекрытие), интерференция как шум. Эталонная валидация P.452 (pytest) выполняется
   только при собранном P452.npz из реальных карт ITU (в CI — skip).

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
| `src/lib/radio/availability.ts` | availability-отчёт P.530-19: недоступность ч/год, цели 99.5/99.9/99.99; R0.01 из карт/ввода/зоны дождя |
| `src/lib/radio/clearance.ts` | clearance-аудит: 0.6·F1 при K = 4/3, 2/3, ∞, класс трассы light/heavy, доп. потери подрефракции |
| `src/lib/radio/noise.ts` | P.372-17: фиты техногенного шума Table 1, `manMadeNoiseFaDb`, комбинация `systemNoisePowerDbm` |
| `src/lib/radio/share.ts` | share-ссылка (этап UX.1): encode/decode URL-hash входных параметров (zod, tolerant), base64url equipment |
| `src/lib/radio/presets.ts` | пользовательские пресеты оборудования (этап UX.2): localStorage `radio-presets`, merge/replace, JSON-файл v1 |
| `src/lib/radio/mesh.ts` | mesh-заготовка (этап UX.6): типы MeshLink/MeshChain + `evaluateMeshChain` (бросает исключение; п. 2.4 ROADMAP заморожен) |
| `src/lib/radio/interference.ts` | интерференция C/I (роадмап 2.3): клиент /api/interference + фоллбек P.2001-lite, чистые `buildInterferenceReport`/`interferenceLevel`/`discriminationAngleDeg`/`interferenceImpact` |
| `src/lib/radio/map-coverage.ts` | покрытие на карте (этап 2.5): coverageBounds/marginAt/coverageColorAt/renderCoverageOverlay — канва-оверлей уровней |
| `mini-services/radio-service/p452_port/` | вендоренный порт Py452 (ITU-R P.452-18, лицензия в LICENSE); npz из env RADIO_P452_NPZ; карты ITU не распространяются (scripts/build_p452_npz.py) |
| `mini-services/radio-service/reports.py` | python-зеркало availability + clearance (эталонные формулы, pytest) |
| `mini-services/radio-service/itm_port.py` + `itm_model.py` | вендоренный ITM v1.2.2 + адаптер модели 'itm' (pytest test_itm.py) |
| `src/lib/radio/route.ts` | файл траектории: `parseRouteFile` (JSON → zod), сегментация с кэшем (WeakMap), `routeStateAt(route, t)` — позиция/высота/скорость/вертикальная скорость в момент t, `routeDurationS` |
| `mini-services/radio-service/main.py` | FastAPI: `/api/calculate`, `/api/maps/*`, `/api/clutter`, `/api/history`, `/api/dem`; валидация карт (`_looks_like_numeric_grid`) |
| `mini-services/radio-service/p2001_lite.py` | P.2001-lite + бюджет (python) |
| `src/components/radio/` | панели: Input, Equipment, Results, Dynamics, History, Maps, Map, Coverage, Pwa |
| `src/app/page.tsx` | вкладки Расчёт/Динамика/История/Карты, порядок панелей, `loadItuMaps()` на монте |
| `deploy/` | docker-compose http/wasm, openresty |
| `ROADMAP.md` | план развития: анализ предметной области (ITU-R по классам задач), gap-анализ, этапы (этап 1 — availability/clearance/дифракция/P.372; этап 2 — ITM/UAV/C-I/сеть; этап 3 — калибровка; 3.1 спутник и 3.2 3GPP отложены) |
