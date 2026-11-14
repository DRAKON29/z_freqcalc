# =============================================================================
# Скачивание эталонных таблиц ITU-R P.528-5 (ZIP-E «Data Tables») — Windows 11.
# Таблицы не распространяются с репозиторием: их скачивает пользователь.
# =============================================================================
# После скачивания таблицы распаковываются в
# mini-services/radio-service/tests/p528_validation_examples/ — путь, который
# читает tests/test_p528.py (golden-слой P.528).
# В CI таблицы качаются best-effort шагом в job test (см. .github/workflows/ci.yml).

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repo "mini-services\radio-service\tests\p528_validation_examples"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$zipUrl = "https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.528-5-202109-I!!ZIP-E.zip"
$zipPath = Join-Path $env:TEMP "P528-5_tables.zip"

Write-Host "Эталонные таблицы ITU-R P.528-5 поставляются ZIP-E с itu.int:" -ForegroundColor Cyan
Write-Host "  $zipUrl" -ForegroundColor Gray
Write-Host -NoNewline "Скачивание ... "
& curl.exe -L -s -S -f -o $zipPath $zipUrl
if ($LASTEXITCODE -eq 0) {
    Write-Host "OK" -ForegroundColor Green
    Write-Host "Распаковка Data Tables в $dest ..."
    Expand-Archive -Path $zipPath -DestinationPath (Join-Path $env:TEMP "P528-5") -Force
    Copy-Item (Join-Path $env:TEMP "P528-5\Data Tables\*.csv") $dest
    Remove-Item $zipPath
    Write-Host "Готово: $( (Get-ChildItem $dest -Filter *.csv).Count ) CSV." -ForegroundColor Green
} else {
    Write-Host "FAILED — скачайте ZIP вручную со страницы https://www.itu.int/rec/R-REC-P.528-5-202109-I/en" -ForegroundColor Red
    Write-Host "и распакуйте Data Tables/*.csv в:" -ForegroundColor Red
    Write-Host "  $dest" -ForegroundColor Yellow
}
