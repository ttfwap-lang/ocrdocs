<#
.SYNOPSIS
  Chains bounded autonomy windows so charter stages keep completing without manual restarts.

.DESCRIPTION
  Supervises `scripts/autonomy/runner.mjs`. Each window: honour `automation/STOP`, reconcile
  `automation/checkpoint.json`, decide whether the window may start, launch the runner with
  captured evidence, classify the outcome, append a ledger row, and immediately start the
  next window. It never weakens a gate and never fabricates progress:

    * `automation/STOP` is honoured and never removed.
    * The persisted deadline is only extended by consuming an owner-placed `automation/RENEW`
      token (one per window), which is moved to `automation/true-e2e/renewals/` as evidence
      and recorded in `STATE.md`.
    * `-ExtendPivots` resets the stage pivot/attempt budget at most once per invocation, and
      only with a recorded reason; the next attempt still needs a materially different plan.
    * Three consecutive windows with no real checkpoint change stop the chain instead of
      hot-looping.

  Evidence is written under `automation/true-e2e/`; nothing is written into `.junie/`.

.PARAMETER StartStage
  Stage used only when no checkpoint exists yet. An existing checkpoint resumes its own next
  stage; this cannot skip failed work.

.PARAMETER EndStage
  Last stage this chain will drive. Reaching it does not mark the remaining roadmap complete.

.PARAMETER WindowHours
  Runtime budget of a *new* deadline (<= 72). An existing checkpoint deadline is authoritative
  and is not silently extended.

.PARAMETER CommandSeconds
  Per-command timeout handed to the runner.

.PARAMETER MaxPivots
  Pivot ceiling handed to the runner (0-3).

.PARAMETER Windows
  How many windows to chain. 0 means "until complete, halted by an owner gate, or stalled".

.PARAMETER CooldownSec
  Pause between windows, so a failing environment is not hammered.

.PARAMETER ExtendPivots
  Allow one recorded pivot-budget reset in this invocation when the checkpoint is blocked with
  an exhausted budget.

.PARAMETER DryRun
  Print the decision and the planned windows. Launches nothing, changes nothing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\true-e2e\scripts\true-e2e-loop.ps1 -DryRun

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\true-e2e\scripts\true-e2e-loop.ps1 -Windows 0
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 55)][int]$StartStage = 2,
    [ValidateRange(1, 55)][int]$EndStage = 55,
    [ValidateRange(0.001, 72)][double]$WindowHours = 72,
    [ValidateRange(1, 3600)][int]$CommandSeconds = 1800,
    [ValidateRange(0, 3)][int]$MaxPivots = 1,
    [ValidateRange(0, 500)][int]$Windows = 1,
    [ValidateRange(0, 3600)][int]$CooldownSec = 30,
    [switch]$ExtendPivots,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json'))) {
    Write-Output "RESULT=repo-root-not-found probed=$repoRoot"
    exit 2
}

$controlDir = Join-Path $repoRoot 'automation'
$stopFile = Join-Path $controlDir 'STOP'
$renewFile = Join-Path $controlDir 'RENEW'
$lockFile = Join-Path $controlDir 'runner.lock'
$checkpointFile = Join-Path $controlDir 'checkpoint.json'
$journalFile = Join-Path $controlDir 'promotion.json'
$runnerFile = Join-Path $repoRoot 'scripts\autonomy\runner.mjs'
$workDir = Join-Path $controlDir 'true-e2e'
$ledgerFile = Join-Path $workDir 'ledger.md'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceDir = Join-Path $workDir "windows\$runId"

if (-not (Test-Path -LiteralPath $runnerFile)) {
    Write-Output "RESULT=runner-missing path=$runnerFile"
    exit 2
}

function Get-Checkpoint {
    if (-not (Test-Path -LiteralPath $checkpointFile)) { return $null }
    try { return Get-Content -LiteralPath $checkpointFile -Raw | ConvertFrom-Json }
    catch { throw "Unreadable checkpoint: $checkpointFile" }
}

function Write-TextNoBom {
    param([string]$Path, [string]$Text)
    # Windows PowerShell's -Encoding UTF8 emits a BOM, and a BOM makes the controller's
    # JSON.parse of checkpoint.json fail. Control state must stay BOM-free.
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Save-Checkpoint {
    param([psobject]$Checkpoint)
    $json = $Checkpoint | ConvertTo-Json -Depth 8
    Write-TextNoBom -Path $checkpointFile -Text ($json + "`n")
}

function Get-StateSignature {
    param([psobject]$Checkpoint)
    if ($null -eq $Checkpoint) { return 'none' }
    $completed = 0
    if ($Checkpoint.completed) { $completed = @($Checkpoint.completed).Count }
    $failure = ''
    if ($Checkpoint.failure) { $failure = "$($Checkpoint.failure.key):$($Checkpoint.failure.consecutive):$($Checkpoint.failure.message)" }
    return "next=$($Checkpoint.nextStage)|done=$completed|attempt=$($Checkpoint.attempt)|pivots=$($Checkpoint.pivots)|status=$($Checkpoint.status)|blocker=$($Checkpoint.blocker)|failure=$failure"
}

function Test-RunnerAlive {
    if (-not (Test-Path -LiteralPath $lockFile)) { return $false }
    try { $owner = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json } catch { return $true }
    if (-not $owner.pid) { return $true }
    return [bool](Get-Process -Id $owner.pid -ErrorAction SilentlyContinue)
}

function Add-LedgerLine {
    param([string]$Line)
    New-Item -ItemType Directory -Force -Path $workDir | Out-Null
    if (-not (Test-Path -LiteralPath $ledgerFile)) {
        $header = @(
            '# True-E2E run ledger',
            '',
            'Append-only window evidence written by true-e2e-loop.ps1. See',
            '`.junie/skills/true-e2e/templates/stage-ledger.md` for the stage-level rows.',
            '',
            '| UTC | Run | Window | Outcome | Exit | Checkpoint signature | Resume action |',
            '|---|---|---|---|---|---|---|'
        )
        Write-TextNoBom -Path $ledgerFile -Text (($header -join "`r`n") + "`r`n")
    }
    Add-Content -LiteralPath $ledgerFile -Value $Line
}

function Add-StateNote {
    param([string]$Note)
    $stateFile = Join-Path $repoRoot 'STATE.md'
    if (-not (Test-Path -LiteralPath $stateFile)) { return }
    Add-Content -LiteralPath $stateFile -Value ("`n- " + (Get-Date).ToUniversalTime().ToString('o') + " $Note`n")
}

function Write-Row {
    param([int]$Window, [string]$Outcome, [string]$Exit, [string]$Signature, [string]$Resume)
    $utc = (Get-Date).ToUniversalTime().ToString('o')
    # Pipes would break the markdown row, so they are shown as separators.
    $cell = $Signature -replace '\|', ' · '
    Add-LedgerLine "| $utc | $runId | $Window | $Outcome | $Exit | $cell | $Resume |"
    Write-Output "WINDOW=$Window OUTCOME=$Outcome EXIT=$Exit RESUME=$Resume"
}

function Invoke-DownstreamRefinement {
    param([int]$Stage)
    $refineScript = Join-Path $repoRoot 'scripts\stages\refine-downstream.mjs'
    if (-not (Test-Path -LiteralPath $refineScript)) { return }
    Write-Output "S7.5 POST-STAGE REFINEMENT: cascading Stage $Stage deliverables to downstream dossiers..."
    $stagePad = "{0:D2}" -f $Stage
    $evDir = Join-Path $repoRoot "automation\runs\stage-$stagePad"
    $refineArgs = @('--stage', "$Stage")
    if (Test-Path -LiteralPath $evDir) {
        $refineArgs += @('--evidence-dir', $evDir)
    }
    Push-Location $repoRoot
    try {
        & node $refineScript @refineArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Downstream refinement exited with code $LASTEXITCODE for Stage $Stage"
        }
        else {
            Write-Output "OK: S7.5 downstream refinement complete for Stage $Stage"
        }
    }
    finally {
        Pop-Location
    }
}

$permanentPattern = 'unauthenticated|authentication (failed|required)|invalid.*token|unauthorized|not logged in|Stop requested|Another runner owns'

Write-Output '================ TRUE E2E LOOP ================'
Write-Output ("REPO_ROOT   = " + $repoRoot)
Write-Output ("RANGE       = stages $StartStage..$EndStage")
Write-Output ("WINDOWS     = " + $(if ($Windows -eq 0) { 'until complete / owner gate / stall' } else { $Windows }))
Write-Output ("WINDOW_HOURS= " + $WindowHours + " (only applies to a new deadline)")
Write-Output ("EVIDENCE    = " + $evidenceDir)
Write-Output ("MODE        = " + $(if ($DryRun) { 'dry-run' } else { 'live' }))
Write-Output '==============================================='

$checkpoint = Get-Checkpoint
Write-Output ("CHECKPOINT  = " + (Get-StateSignature -Checkpoint $checkpoint))

if (Test-Path -LiteralPath $stopFile) {
    Write-Output 'RESULT=halted-owner-gate reason=stop-file'
    Write-Output "OWNER ACTION: delete $stopFile to resume. This script will not remove it."
    exit 3
}

if ($checkpoint -and $checkpoint.status -eq 'running' -and -not (Test-RunnerAlive)) {
    Write-Output 'NOTE: checkpoint says running but no live runner lock was found; the previous window was interrupted, not completed.'
}

if (Test-RunnerAlive) {
    Write-Output 'RESULT=halted-owner-gate reason=another-runner-owns-project'
    Write-Output "OWNER ACTION: let the live runner finish, or inspect $lockFile."
    exit 3
}

if (Test-Path -LiteralPath $journalFile) {
    try { $journal = Get-Content -LiteralPath $journalFile -Raw | ConvertFrom-Json } catch { $journal = $null }
    if ($journal -and $journal.status -eq 'pending') {
        Write-Output 'NOTE: a pending promotion journal exists; the runner rolls it forward before new work.'
    }
}

$pivotResetUsed = $false
$windowIndex = 0
$noProgress = 0
$previousSignature = Get-StateSignature -Checkpoint $checkpoint
$previousCompleted = if ($checkpoint -and $checkpoint.completed) { @($checkpoint.completed) } else { @() }

while ($Windows -eq 0 -or $windowIndex -lt $Windows) {
    $windowIndex++

    if (Test-Path -LiteralPath $stopFile) {
        Write-Row -Window $windowIndex -Outcome 'blocked-owner' -Exit 'n/a' -Signature $previousSignature -Resume 'stop file present; owner removes it'
        Write-Output 'RESULT=halted-owner-gate reason=stop-file'
        exit 3
    }

    $checkpoint = Get-Checkpoint
    $signature = Get-StateSignature -Checkpoint $checkpoint

    if ($checkpoint) {
        # Classify the incoming state before any branch below mutates it.
        $incomingBlocker = "$($checkpoint.blocker)"
        $budgetExhausted = ($checkpoint.status -eq 'blocked') -and ($incomingBlocker -match 'Pivot/retry budget exhausted')
        $completedCount = 0
        if ($checkpoint.completed) { $completedCount = @($checkpoint.completed).Count }
        if ($checkpoint.nextStage -gt $EndStage) {
            $scope = if ($completedCount -ge 55) { 'roadmap' } else { 'selected-range' }
            Write-Row -Window $windowIndex -Outcome 'promoted' -Exit '0' -Signature $signature -Resume "range complete ($scope)"
            Write-Output "RESULT=complete scope=$scope completed=$completedCount next_stage=$($checkpoint.nextStage)"
            Write-Output 'Verify docs\ACCEPTANCE_REGISTER.md before reporting this as done.'
            exit 0
        }

        if ($checkpoint.deadline) {
            $deadlineUtc = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$checkpoint.deadline).UtcDateTime
            if ((Get-Date).ToUniversalTime() -ge $deadlineUtc) {
                Write-Output ("DEADLINE reached at " + $deadlineUtc.ToString('o'))
                if (-not (Test-Path -LiteralPath $renewFile)) {
                    Write-Row -Window $windowIndex -Outcome 'blocked-owner' -Exit 'n/a' -Signature $signature -Resume 'deadline expired; RENEW token required'
                    Write-Output 'RESULT=halted-owner-gate reason=deadline-expired'
                    Write-Output "OWNER ACTION: create $renewFile (any content) to authorize one more $WindowHours h window."
                    exit 3
                }
                if ($DryRun) {
                    Write-Output 'DRY-RUN: a RENEW token is present and would be consumed for one new window.'
                }
                else {
                    New-Item -ItemType Directory -Force -Path (Join-Path $workDir 'renewals') | Out-Null
                    $consumed = Join-Path $workDir ('renewals\RENEW-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
                    Move-Item -LiteralPath $renewFile -Destination $consumed
                    $newDeadline = [DateTimeOffset]::UtcNow.AddHours($WindowHours).ToUnixTimeMilliseconds()
                    $checkpoint.deadline = $newDeadline
                    if ($checkpoint.PSObject.Properties.Name -contains 'blocker') { $checkpoint.blocker = $null }
                    if ($checkpoint.status -eq 'blocked') { $checkpoint.status = 'ready' }
                    Save-Checkpoint -Checkpoint $checkpoint
                    Add-StateNote ("True-E2E: owner RENEW token consumed ($consumed); new bounded window deadline " + [DateTimeOffset]::FromUnixTimeMilliseconds($newDeadline).UtcDateTime.ToString('o') + ". Stage progress, attempts and pivots unchanged.")
                    Write-Output 'RENEWAL consumed; deadline extended by one bounded window.'
                }
            }
        }

        if ($budgetExhausted -and $ExtendPivots -and -not $pivotResetUsed) {
            if ($DryRun) {
                Write-Output 'DRY-RUN: exhausted pivot budget would be reset once, with a STATE.md record.'
            }
            else {
                $checkpoint.attempt = 0
                $checkpoint.pivots = 0
                $checkpoint.status = 'ready'
                $checkpoint.blocker = $null
                Save-Checkpoint -Checkpoint $checkpoint
                Add-StateNote "True-E2E: explicitly extended the stage $($checkpoint.nextStage) pivot budget; preserved failed candidate evidence remains, and the next attempt requires a materially different plan."
                $pivotResetUsed = $true
                Write-Output 'PIVOT BUDGET reset once for this invocation (recorded in STATE.md).'
            }
        }
        elseif ($budgetExhausted -and -not $ExtendPivots) {
            Write-Row -Window $windowIndex -Outcome 'deferred' -Exit 'n/a' -Signature $signature -Resume 'pivot budget exhausted; rerun with -ExtendPivots after reviewing evidence'
            Write-Output 'RESULT=halted-owner-gate reason=pivot-budget-exhausted'
            Write-Output "OWNER ACTION: review automation\runs evidence, then rerun with -ExtendPivots (a materially different plan is required)."
            exit 3
        }
    }

    if ($DryRun) {
        Write-Output "DRY-RUN: window $windowIndex would run: node scripts\autonomy\runner.mjs --hours $WindowHours --start-stage $StartStage --end-stage $EndStage --command-seconds $CommandSeconds --max-pivots $MaxPivots"
        Write-Output "DRY-RUN: on stage promotion, S7.5 downstream refinement would execute: node scripts\stages\refine-downstream.mjs --stage N"
        if ($Windows -eq 0 -or $windowIndex -ge $Windows) {
            Write-Output 'RESULT=dry-run windows_planned=until-complete-or-gate'
            exit 0
        }
        continue
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Output 'RESULT=error reason=node-unavailable'
        exit 1
    }

    New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
    $log = Join-Path $evidenceDir ("window-$windowIndex.log")
    Write-Output "START window $windowIndex -> $log"

    Push-Location $repoRoot
    $previousPreference = $ErrorActionPreference
    try {
        # A blocked runner writes diagnostics to stderr and exits nonzero. That is data to
        # classify, not a reason to abort the chain, so stderr must not become a terminating
        # error here.
        $ErrorActionPreference = 'Continue'
        & node $runnerFile '--hours' $WindowHours '--start-stage' $StartStage '--end-stage' $EndStage '--command-seconds' $CommandSeconds '--max-pivots' $MaxPivots 2>&1 |
            Tee-Object -FilePath $log
        $runnerExit = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }
    if ($null -eq $runnerExit) { $runnerExit = -1 }

    $checkpoint = Get-Checkpoint
    $signature = Get-StateSignature -Checkpoint $checkpoint
    $blocker = "$($checkpoint.blocker)"
    $status = "$($checkpoint.status)"

    # S7.5 Post-Stage Refinement: if newly completed stages exist, cascade downstream
    $currentCompleted = if ($checkpoint -and $checkpoint.completed) { @($checkpoint.completed) } else { @() }
    $newlyCompleted = $currentCompleted | Where-Object { $_ -notin $previousCompleted }
    foreach ($cStage in $newlyCompleted) {
        Invoke-DownstreamRefinement -Stage $cStage
    }
    $previousCompleted = $currentCompleted

    if ($status -eq 'roadmap-complete' -or ($checkpoint -and $checkpoint.nextStage -gt $EndStage)) {
        Write-Row -Window $windowIndex -Outcome 'promoted' -Exit "$runnerExit" -Signature $signature -Resume 'range complete'
        Write-Output "RESULT=complete status=$status"
        Write-Output 'Verify docs\ACCEPTANCE_REGISTER.md before reporting this as done.'
        exit 0
    }

    if ($status -eq 'blocked' -and $blocker -match $permanentPattern) {
        Write-Row -Window $windowIndex -Outcome 'blocked-owner' -Exit "$runnerExit" -Signature $signature -Resume "owner action: $blocker"
        Write-Output "RESULT=halted-owner-gate reason=$blocker"
        Write-Output 'OWNER ACTION: clear the named condition (authentication, stop request or competing runner), then rerun this script.'
        exit 3
    }

    if ($signature -eq $previousSignature) {
        $noProgress++
        Write-Row -Window $windowIndex -Outcome 'interrupted' -Exit "$runnerExit" -Signature $signature -Resume "no state change ($noProgress/3)"
    }
    else {
        $noProgress = 0
        $outcome = if ($status -eq 'blocked') { 'deferred' } else { 'correcting' }
        Write-Row -Window $windowIndex -Outcome $outcome -Exit "$runnerExit" -Signature $signature -Resume 'chaining next window'
    }
    $previousSignature = $signature

    if ($noProgress -ge 3) {
        Write-Output 'RESULT=stalled reason=three-windows-without-state-change'
        Write-Output 'Write the terminal external ledger (remaining stages + the exact unblocking action) instead of launching another identical window.'
        exit 4
    }

    if ($Windows -eq 0 -or $windowIndex -lt $Windows) {
        Write-Output "COOLDOWN ${CooldownSec}s"
        Start-Sleep -Seconds $CooldownSec
    }
}

Write-Output "RESULT=windows-exhausted windows=$windowIndex checkpoint=$previousSignature"
Write-Output 'Not complete: rerun to chain more windows, or use -Windows 0.'
exit 4
