<#
.SYNOPSIS
  Runs the ocrdocs verification gate concurrently and reports per-check evidence.

.DESCRIPTION
  Launches `npm run lint`, `npm run test` and `npm run build` as independent processes at the
  same time instead of end to end, captures each one's combined output to its own log file,
  and prints a summary with exit codes and durations. Exit code is 0 only if every requested
  check passed, so it can be used as a single gate in an orchestration wave.

  Nothing is modified in the repository except the build output that `npm run build` itself
  produces. No check is ever skipped or weakened on failure; failures are reported.

.PARAMETER Checks
  Subset of checks to run. Default: lint, test, build.

.PARAMETER EvidenceDir
  Where to write the log files. Default: a timestamped folder under the user TEMP directory,
  so the repository is never polluted.

.PARAMETER TimeoutSec
  Per-check timeout. A check that exceeds it is killed (with its child processes) and
  reported as TIMEOUT with exit code 124.

.PARAMETER Sequential
  Run the checks one after another instead of concurrently. Useful when diagnosing a
  failure that only appears under load, or on a machine short of memory.

.PARAMETER TailLines
  How many trailing lines of a failing check's log to print. Default 40.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1 -Checks lint,test
#>
[CmdletBinding()]
param(
    [ValidateSet('lint', 'test', 'build')]
    [string[]]$Checks = @('lint', 'test', 'build'),
    [string]$EvidenceDir,
    [int]$TimeoutSec = 900,
    [switch]$Sequential,
    [int]$TailLines = 40
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json'))) {
    Write-Output "RESULT=repo-root-not-found probed=$repoRoot"
    exit 2
}

if (-not $EvidenceDir) {
    $EvidenceDir = Join-Path $env:TEMP ('ocrdocs-verify-gate\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) {
    Write-Output 'WARNING: node_modules is missing; checks will fail until dependencies are installed.'
}

$mode = if ($Sequential) { 'sequential' } else { 'concurrent' }
Write-Output '================ VERIFY GATE ================'
Write-Output ("REPO_ROOT    = " + $repoRoot)
Write-Output ("CHECKS       = " + ($Checks -join ', '))
Write-Output ("MODE         = " + $mode)
Write-Output ("TIMEOUT_SEC  = " + $TimeoutSec)
Write-Output ("EVIDENCE_DIR = " + $EvidenceDir)
Write-Output '============================================='

function Start-Check {
    param(
        [string]$Name,
        [string]$Root,
        [string]$LogPath
    )

    # cmd.exe does the redirection so stdout and stderr land interleaved in one log file.
    # A raw Process is used rather than Start-Process -PassThru, because the latter drops the
    # process handle and then reports a null ExitCode.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /c npm run {0} > "{1}" 2>&1' -f $Name, $LogPath
    $startInfo.WorkingDirectory = $Root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $null = $process.Handle

    [pscustomobject]@{
        Name      = $Name
        Command   = "npm run $Name"
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
    param(
        [pscustomobject]$Check,
        [int]$RemainingSec
    )

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
        Check    = $Check.Name
        Command  = $Check.Command
        Status   = $status
        ExitCode = $code
        Seconds  = [Math]::Round(((Get-Date) - $Check.StartedAt).TotalSeconds, 1)
        Log      = $Check.Log
    }
}

$gateStart = Get-Date
$results = @()

if ($Sequential) {
    foreach ($name in $Checks) {
        $log = Join-Path $EvidenceDir "$name.log"
        Write-Output ("START  " + $name)
        $running = Start-Check -Name $name -Root $repoRoot -LogPath $log
        $results += Complete-Check -Check $running -RemainingSec $TimeoutSec
    }
}
else {
    $running = @()
    foreach ($name in $Checks) {
        $log = Join-Path $EvidenceDir "$name.log"
        Write-Output ("START  " + $name)
        $running += Start-Check -Name $name -Root $repoRoot -LogPath $log
    }

    foreach ($check in $running) {
        $elapsed = ((Get-Date) - $gateStart).TotalSeconds
        $results += Complete-Check -Check $check -RemainingSec ([int]($TimeoutSec - $elapsed))
    }
}

$wallClock = [Math]::Round(((Get-Date) - $gateStart).TotalSeconds, 1)
$serialEquivalent = [Math]::Round(($results | Measure-Object -Property Seconds -Sum).Sum, 1)

Write-Output ''
Write-Output '------------------ SUMMARY ------------------'
$results | Select-Object Check, Status, ExitCode, Seconds | Format-Table -AutoSize | Out-String -Width 120 | Write-Output
Write-Output ("WALL_CLOCK_SEC       = " + $wallClock)
Write-Output ("SERIAL_EQUIVALENT_SEC= " + $serialEquivalent)
Write-Output ("EVIDENCE_DIR         = " + $EvidenceDir)

$failed = @($results | Where-Object { $_.Status -ne 'PASS' })

foreach ($failure in $failed) {
    Write-Output ''
    Write-Output ("---------- FAILING OUTPUT: " + $failure.Check + " (exit " + $failure.ExitCode + ") ----------")
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
    Write-Output ("RESULT=gate-pass checks=" + ($Checks -join ',') + " wall_clock_sec=" + $wallClock)
    exit 0
}

Write-Output ("RESULT=gate-fail failed=" + (($failed | ForEach-Object { $_.Check }) -join ',') + " wall_clock_sec=" + $wallClock)
exit 1
