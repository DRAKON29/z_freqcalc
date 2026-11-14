# -*- coding: utf-8 -*-
"""
Вендоренный порт Py2001 (ITU-R P.2001-6) для z_freqcalc.

Источник: https://github.com/eeveetza/Py2001 — Ivica Stevanovic, Adrien
Demarez, Federal Office of Communications (OFCOM), Switzerland.
Реализация — перевод эталонной MATLAB/Octave реализации, утверждённой
ITU-R WP 3M (SG3 software & validation database). Лицензия — LICENSE рядом
(AS IS; модификации и распространение разрешены с атрибуцией и пометкой
изменений). Код P2001.py используется «как есть», кроме одной правки
загрузки цифровых карт (заголовок P2001.py, пункт «Изменения»).

Цифровые карты ITU (14 таблиц P.2001-6: DN_Median, DN_SubSlope, DN_SupSlope,
dndz_01, Esarain_*, FoEs*, h0, surfwv_50_fixed, TropoClim) НЕ входят
в репозиторий и не распространяются: их скачивает пользователь с сайта ITU-R,
после чего scripts/build_p2001_npz.py собирает P2001.npz (main.py задаёт
путь через env RADIO_P2001_NPZ). Без npz импорт этого пакета падает — это
ожидаемое поведение: main.py._py2001_available() тракует его как «полная
P.2001-6 недоступна» и расчёт уходит в P.2001-lite.
"""
from .P2001 import bt_loss, tl_free_space  # noqa: F401
