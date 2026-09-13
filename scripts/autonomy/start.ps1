param(
    [ValidateRange(0.001, 72)][double]$Hours = 72,
    [ValidateRange(1, 55)][int]$StartStage = 2,
    [ValidateRange(1, 55)][int]$EndStage = 55,
    [ValidateRange(1, 3600)][int]$CommandSeconds = 1800,
    [ValidateRange(0, 3)][int]$MaxPivots = 1
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
foreach ($Command in @('node', 'npm', 'bun', 'junie')) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Required command is unavailable: $Command"
    }
}
Push-Location $ProjectRoot
try {
    & node (Join-Path $PSScriptRoot 'runner.mjs') '--hours' $Hours '--start-stage' $StartStage '--end-stage' $EndStage '--command-seconds' $CommandSeconds '--max-pivots' $MaxPivots
    exit $LASTEXITCODE
} finally {
    Pop-Location
}