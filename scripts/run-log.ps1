param([string]$Name, [string]$Command)
$logDir = Join-Path $PSScriptRoot '..\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$lines = & pwsh -NoProfile -Command $Command 2>&1
$code = $LASTEXITCODE
$raw = ($lines | Out-String)
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($raw))).ToLower()
$cacheDir = Join-Path $PSScriptRoot '..\.headroom-cache'
New-Item -ItemType Directory -Force $cacheDir | Out-Null
$raw | Set-Content -LiteralPath (Join-Path $cacheDir "$hash.txt")
$raw | Set-Content -LiteralPath (Join-Path $logDir "$Name.txt")
Write-Output "LOG $Name exit=$code sha256=$hash lines=$($lines.Count)"
$lines | Select-Object -First 3
$lines | Where-Object { $_ -match 'error|failed|warning|Test Files|Tests |passed|Finished|Bundling|Built|Running|✓|✘' }
$lines | Select-Object -Last 2
exit $code
