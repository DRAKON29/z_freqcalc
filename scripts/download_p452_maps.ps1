# =============================================================================
# Скачивание цифровых карт ITU-R P.452-18 (N050.TXT, DN50.TXT) — Windows 11.
# Карта ITU не может распространяться с репозиторием: её скачивает пользователь.
# =============================================================================
# URL проверены на момент написания; если ITU изменил пути — скачайте файлы
# вручную со страницы P.452-18 на itu.int (раздел «Data»/SG3 software & validation)
# и положите их в mini-services/radio-service/data/p452_maps/.
# После скачивания: python scripts/build_p452_npz.py

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repo "mini-services\radio-service\data\p452_maps"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$maps = @(
    @{ File = "N050.TXT"; Url = "https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.452-18-202310-I!!ZIP-E.zip" },
    @{ File = "DN50.TXT"; Url = "https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.452-18-202310-I!!ZIP-E.zip" }
)

Write-Host "Карты ITU-R P.452-18 поставляются архивом/файлами с itu.int." -ForegroundColor Cyan
Write-Host "Если прямые ссылки изменились — скачайте вручную со страницы рекомендации P.452-18" -ForegroundColor Cyan
Write-Host "(https://www.itu.int/rec/R-REC-P.452/ru) и распакуйте N050.TXT + DN50.TXT в:" -ForegroundColor Cyan
Write-Host "  $dest" -ForegroundColor Yellow
foreach ($m in $maps) {
    Write-Host -NoNewline "Попытка $($m.File) ... "
    & curl.exe -L -s -S -f -o (Join-Path $dest $m.File) $m.Url
    if ($LASTEXITCODE -eq 0) { Write-Host "OK" -ForegroundColor Green } else { Write-Host "FAILED (скачайте вручную)" -ForegroundColor Red }
}
Write-Host ""
Write-Host "Далее: python scripts/build_p452_npz.py  (соберёт P452.npz)"
