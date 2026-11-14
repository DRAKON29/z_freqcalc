# -*- coding: utf-8 -*-
"""
Вендоренный порт Py452 (ITU-R P.452-18) для z_freqcalc.

Источник: https://github.com/eeveetza/Py452 — Ivica Stevanovic, Federal Office
of Communications (OFCOM), Switzerland. Реализация функционально идентична
эталонной MATLAB/Octave реализации, утверждённой ITU-R WP 3M (SG3 software &
validation database). Лицензия — LICENSE рядом (AS IS; модификации и
распространение разрешены с атрибуцией и пометкой изменений). Код P452.py
используется «как есть», кроме одной правки загрузки цифровых карт
(заголовок P452.py, пункт «Изменения»).

Цифровые карты ITU (N050.TXT, DN50.TXT) НЕ входят в репозиторий и не
распространяются: их скачивает пользователь с сайта ITU-R, после чего
scripts/build_p452_npz.py собирает P452.npz (main.py задаёт путь через
env RADIO_P452_NPZ). Без npz импорт этого пакета падает — это ожидаемое
поведение: main.py._p452_available() тракует его как «P.452 недоступен»
и клиент уходит в TS-фоллбек P.2001-lite.
"""
from .P452 import bt_loss  # noqa: F401
