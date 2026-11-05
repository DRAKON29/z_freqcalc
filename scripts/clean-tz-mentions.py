#!/usr/bin/env python3
"""Очистка упоминаний ТЗ из комментариев в исходниках src/."""
import re
import pathlib

ROOT = pathlib.Path('/home/z/my-project/src')

# Паттерны упоминаний ТЗ в комментариях
PATTERNS = [
    re.compile(r'\s*—\s*ТЗ\s*[\d.v]+(?:\s*[/,.]\s*[\d.]+)*\s*(?=[:)•\-—]|\s|$)'),
    re.compile(r'\s*\(\s*ТЗ\s*[^)]*\)\s*'),
    re.compile(r'\s*ТЗ\s*[\d.v]+(?:\s*[/,.]\s*[\d.]+)*\s*:'),
    re.compile(r'\s*по\s+ТЗ\s*[\d.v]+(?:\s*[/,.]\s*[\d.]+)*'),
    re.compile(r'\s*\(формула\s*ТЗ\)'),
    re.compile(r'\s*\(строго по формуле\s*ТЗ\)'),
    re.compile(r'\s*ТЗ\s*[\d.v]+(?:\s*[/,.]\s*[\d.]+)*(?=\s|$)'),
    re.compile(r'\s*ТЗ\s*v[\d.]+'),
]


def clean_line(line: str) -> str:
    for pat in PATTERNS:
        line = pat.sub('', line)
    # Убрать висячие знаки препинания и двойные пробелы
    line = line.replace('  ', ' ')
    line = re.sub(r'\s+([.,;:)])', r'\1', line)
    line = re.sub(r'\(\s*\)', '', line)
    line = re.sub(r'--\s*$', '', line)
    line = line.rstrip()
    return line


changed = 0
for path in ROOT.rglob('*.ts'):
    for path0 in [path] + list(ROOT.rglob('*.tsx')) and []:
        pass

for ext in ('*.ts', '*.tsx'):
    for path in ROOT.rglob(ext):
        text = path.read_text(encoding='utf-8')
        lines = text.split('\n')
        out = []
        dirty = False
        for line in lines:
            if 'ТЗ' in line:
                new = clean_line(line)
                if new != line:
                    dirty = True
                line = new
            out.append(line)
        if dirty:
            path.write_text('\n'.join(out), encoding='utf-8')
            changed += 1

print(f'files changed: {changed}')
