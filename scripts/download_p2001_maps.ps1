# =============================================================================
# Скачивание цифровых карт ITU-R P.2001-6 (14 таблиц .txt) — Windows 11.
# Карты ITU не могут распространяться с репозиторием: их скачивает пользователь.
# =============================================================================
# URL проверен на момент написания (см. README eeveetza/Py2001); если ITU
# изменил пути — скачайте ZIP-E вручную со страницы P.2001-6 на itu.int
# (раздел «Data») и распакуйте .txt в mini-services/radio-service/data/p2001_maps/.
# После скачивания: python scripts/build_p2001_npz.py

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repo "mini-services\radio-service\data\p2001_maps"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$zipUrl = "https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.2001-6-202509-I!!ZIP-E.zip"
$zipPath = Join-Path $env:TEMP "P2001-6_maps.zip"

Write-Host "Карты ITU-R P.2001-6 поставляются архивом ZIP-E с itu.int:" -ForegroundColor Cyan
Write-Host "  $zipUrl" -ForegroundColor Gray
Write-Host -NoNewline "Скачивание ... "
& curl.exe -L -s -S -f -o $zipPath $zipUrl
if ($LASTEXITCODE -eq 0) {
    Write-Host "OK" -ForegroundColor Green
    Write-Host "Распаковка в $dest ..."
    Expand-Archive -Path $zipPath -DestinationPath $dest -Force
    Remove-Item $zipPath
} else {
    Write-Host "FAILED — скачайте ZIP вручную со страницы https://www.itu.int/rec/R-REC-P.2001" -ForegroundColor Red
    Write-Host "и распакуйте .txt в:" -ForegroundColor Red
    Write-Host "  $dest" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Далее: python scripts/build_p2001_npz.py  (соберёт P2001.npz)"
