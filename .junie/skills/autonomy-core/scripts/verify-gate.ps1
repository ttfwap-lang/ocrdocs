<#
.SYNOPSIS
  Portable verification gate: runs a project's real check commands concurrently and reports
  per-check evidence with exit codes.

.DESCRIPTION
  The project-agnostic sibling of .junie\skills\max-throughput\scripts\verify-gate.ps1. Use it
  in a project that does not have its own gate runner yet.

  Commands are either given explicitly with -Commands, or detected from the manifests present
  in the target root (npm/pnpm/yarn/bun, Cargo, .NET, Python). Each command runs as its own
  process at the same time instead of end to end; combined output is captured to one log file
  per check; the summary prints status, exit code and duration.

  Exit code is 0 only when every check passed, so the script can be used as a single gate.
  Nothing is modified except whatever the project's own build produces. No check is ever
  skipped or weakened on failure - failures are reported with their output.

.PARAMETER TargetRoot
  Project root. Default: the current directory.

.PARAMETER Commands
  Explicit check commands, e.g. -Commands 'npm run lint','npm test'. Overrides detection.

.PARAMETER EvidenceDir
  Where log files are written. Default: a timestamped folder under TEMP, so the repository is
  never polluted.

.PARAMETER TimeoutSec
  Per-check timeout. A check that exceeds it is killed with its child processes and reported
  as TIMEOUT with exit code 124.

.PARAMETER Sequential
  Run checks one after another - for diagnosing load-sensitive failures.

.PARAMETER TailLines
  Trailing lines of a failing check's log to print. Default 40.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\autonomy-core\scripts\verify-gate.ps1 -TargetRoot C:\proj

.EXAMPLE
  powershell -ExecutionPolicy Bypass -Command "& .junie\skills\autonomy-core\scripts\verify-gate.ps1 -Commands 'cargo clippy -- -D warnings','cargo test'"
#>
[CmdletBinding()]
param(
    [string]$TargetRoot,
    [string[]]$Commands,
    [string]$EvidenceDir,
    [int]$TimeoutSec = 900,
    [switch]$Sequential,
    [int]$TailLines = 40
)

$ErrorActionPreference = 'Stop'

if (-not $TargetRoot) { $TargetRoot = (Get-Location).Path }
if (-not (Test-Path -LiteralPath $TargetRoot)) {
    Write-Output "RESULT=target-root-not-found probed=$TargetRoot"
    exit 2
}
$TargetRoot = (Resolve-Path -LiteralPath $TargetRoot).Path

function Get-DetectedCommands {
    param([string]$Root)

    $found = @()

    $packageJson = Join-Path $Root 'package.json'
    if (Test-Path -LiteralPath $packageJson) {
        $runner = 'npm run'
        $testRunner = 'npm test'
        if (Test-Path -LiteralPath (Join-Path $Root 'pnpm-lock.yaml')) { $runner = 'pnpm run'; $testRunner = 'pnpm test' }
        elseif (Test-Path -LiteralPath (Join-Path $Root 'yarn.lock')) { $runner = 'yarn'; $testRunner = 'yarn test' }
        elseif (Test-Path -LiteralPath (Join-Path $Root 'bun.lock')) { $runner = 'npm run'; $testRunner = 'npm test' }

        $scripts = @{}
        try {
            $parsed = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
            if ($parsed.scripts) {
                foreach ($property in $parsed.scripts.PSObject.Properties) { $scripts[$property.Name] = $property.Value }
            }
        }
        catch {
            Write-Output "WARNING: package.json could not be parsed; detection skipped for it."
        }

        foreach ($name in @('lint', 'typecheck', 'test', 'build')) {
            if ($scripts.ContainsKey($name)) {
                if ($name -eq 'test') { $found += $testRunner } else { $found += "$runner $name" }
            }
        }
    }

    if (Test-Path -LiteralPath (Join-Path $Root 'Cargo.toml')) {
        $found += 'cargo build --locked'
        $found += 'cargo test --locked'
    }

    if (Test-Path -LiteralPath (Join-Path $Root 'pyproject.toml')) {
        $found += 'python -m pytest -q'
    }

    if (@(Get-ChildItem -LiteralPath $Root -Filter '*.sln' -File -ErrorAction SilentlyContinue).Count -gt 0) {
        $found += 'dotnet build'
        $found += 'dotnet test'
    }

    return , @($found | Select-Object -Unique)
}

if (-not $Commands -or $Commands.Count -eq 0) {
    $Commands = Get-DetectedCommands -Root $TargetRoot
}

if (-not $Commands -or $Commands.Count -eq 0) {
    Write-Output "RESULT=no-checks-detected root=$TargetRoot"
    Write-Output 'Pass the project checks explicitly with -Commands. A project without checks has no gate,'
    Write-Output 'and a setup without a gate cannot promote a stage.'
    exit 3
}

if (-not $EvidenceDir) {
    $EvidenceDir = Join-Path $env:TEMP ('autonomy-core-gate\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$mode = if ($Sequential) { 'sequential' } else { 'concurrent' }
Write-Output '================ VERIFY GATE ================'
Write-Output ("TARGET_ROOT  = " + $TargetRoot)
Write-Output ("CHECKS       = " + ($Commands -join ' | '))
Write-Output ("MODE         = " + $mode)
Write-Output ("TIMEOUT_SEC  = " + $TimeoutSec)
Write-Output ("EVIDENCE_DIR = " + $EvidenceDir)
Write-Output '============================================='

function Get-CheckLabel {
    param([string]$Command, [int]$Index)

    $slug = ($Command -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLowerInvariant()
    if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40) }
    if (-not $slug) { $slug = 'check' }
    return ('{0:d2}-{1}' -f $Index, $slug)
}

function Start-Check {
    param([string]$Command, [string]$Root, [string]$LogPath, [string]$Label)

    # cmd.exe performs the redirection so stdout and stderr land interleaved in one log.
    # A raw Process is used rather than Start-Process -PassThru, which drops the handle and
    # then reports a null ExitCode.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /c {0} > "{1}" 2>&1' -f $Command, $LogPath
    $startInfo.WorkingDirectory = $Root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $null = $process.Handle

    [pscustomobject]@{
        Label     = $Label
        Command   = $Command
        Log       = $LogPath
        Process   = $process
        StartedAt = Get-Date
    }
}

function Stop-CheckTree {
    param([int]$ProcessId)
    try { & taskkill.exe /T /F /PID $ProcessId *> $null } catch { }
}

function Complete-Check {
    param([pscustomobject]$Check, [int]$RemainingSec)

    $waitMs = [Math]::Max(1, $RemainingSec) * 1000
    $exited = $Check.Process.WaitForExit($waitMs)

    if (-not $exited) {
        Stop-CheckTree -ProcessId $Check.Process.Id
        $status = 'TIMEOUT'
        $code = 124
    }
    else {
        $code = $Check.Process.ExitCode
        $status = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    }

    [pscustomobject]@{
        Check    = $Check.Label
        Command  = $Check.Command
        Status   = $status
        ExitCode = $code
        Seconds  = [Math]::Round(((Get-Date) - $Check.StartedAt).TotalSeconds, 1)
        Log      = $Check.Log
    }
}

$gateStart = Get-Date
$results = @()
$index = 0
$pending = @()

foreach ($command in $Commands) {
    $index++
    $label = Get-CheckLabel -Command $command -Index $index
    $log = Join-Path $EvidenceDir "$label.log"
    Write-Output ("START  " + $label + "  ->  " + $command)
    $started = Start-Check -Command $command -Root $TargetRoot -LogPath $log -Label $label

    if ($Sequential) {
        $results += Complete-Check -Check $started -RemainingSec $TimeoutSec
    }
    else {
        $pending += $started
    }
}

foreach ($check in $pending) {
    $elapsed = ((Get-Date) - $gateStart).TotalSeconds
    $results += Complete-Check -Check $check -RemainingSec ([int]($TimeoutSec - $elapsed))
}

$wallClock = [Math]::Round(((Get-Date) - $gateStart).TotalSeconds, 1)
$serialEquivalent = [Math]::Round(($results | Measure-Object -Property Seconds -Sum).Sum, 1)

Write-Output ''
Write-Output '------------------ SUMMARY ------------------'
$results | Select-Object Check, Status, ExitCode, Seconds, Command | Format-Table -AutoSize | Out-String -Width 160 | Write-Output
Write-Output ("WALL_CLOCK_SEC       = " + $wallClock)
Write-Output ("SERIAL_EQUIVALENT_SEC= " + $serialEquivalent)
Write-Output ("EVIDENCE_DIR         = " + $EvidenceDir)

$failed = @($results | Where-Object { $_.Status -ne 'PASS' })

foreach ($failure in $failed) {
    Write-Output ''
    Write-Output ("---------- FAILING OUTPUT: " + $failure.Command + " (exit " + $failure.ExitCode + ") ----------")
    if (Test-Path -LiteralPath $failure.Log) {
        Get-Content -LiteralPath $failure.Log -Tail $TailLines | Write-Output
    }
    else {
        Write-Output '(no log captured)'
    }
    Write-Output ("full log: " + $failure.Log)
}

Write-Output ''
if ($failed.Count -eq 0) {
    Write-Output ("RESULT=gate-pass checks=" + $results.Count + " wall_clock_sec=" + $wallClock)
    exit 0
}

Write-Output ("RESULT=gate-fail failed=" + (($failed | ForEach-Object { $_.Check }) -join ',') + " wall_clock_sec=" + $wallClock)
exit 1
