<#
.SYNOPSIS
  Creates or removes an isolated git worktree for one implementation lane.

.DESCRIPTION
  The orchestration rule is one writer per file. When two lanes genuinely must touch the same
  file, give each lane its own worktree and merge afterwards instead of letting them overwrite
  each other in the shared tree.

  Each lane gets a sibling directory `<repo>-lane-<name>` on branch `lane/<name>`, created
  from the given base commit. Spawn the lane with `projectDir` pointed at that directory.

  This script is deliberately conservative: it never commits, never force-removes, never
  deletes a branch, and never touches the main working tree. Merging is left to the
  orchestrator, who is told the exact commands to run.

.PARAMETER Lane
  Short lane name, lowercase: letters, digits, dot, dash, underscore.

.PARAMETER Base
  Commit-ish the lane branches from. Default: HEAD.

.PARAMETER ParentDir
  Where the lane directory is created. Default: the parent of the repository root.

.PARAMETER List
  List existing worktrees and lane branches, then exit.

.PARAMETER Remove
  Remove the lane's worktree. The branch is kept so the work is never silently lost.

.PARAMETER DryRun
  Print the git commands that would run, without running them.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\new-lane-worktree.ps1 -Lane server-api

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\new-lane-worktree.ps1 -Lane server-api -Remove
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Remove')]
    [string]$Lane,

    [Parameter(ParameterSetName = 'Create')]
    [string]$Base = 'HEAD',

    [Parameter(ParameterSetName = 'Create')]
    [Parameter(ParameterSetName = 'Remove')]
    [string]$ParentDir,

    [Parameter(Mandatory = $true, ParameterSetName = 'List')]
    [switch]$List,

    [Parameter(Mandatory = $true, ParameterSetName = 'Remove')]
    [switch]$Remove,

    [Parameter(ParameterSetName = 'Create')]
    [Parameter(ParameterSetName = 'Remove')]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Output 'RESULT=git-not-available'
    exit 2
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
    Write-Output ("RESULT=not-a-git-repo probed=" + $repoRoot)
    exit 3
}

function Invoke-Git {
    param([string[]]$GitArgs)

    if ($DryRun) {
        Write-Output ('DRYRUN: git -C "' + $repoRoot + '" ' + ($GitArgs -join ' '))
        return
    }

    & git -C $repoRoot @GitArgs 2>&1 | Write-Output
}

if ($List) {
    Write-Output '=== worktrees ==='
    & git -C $repoRoot worktree list | Write-Output
    Write-Output '=== lane branches ==='
    & git -C $repoRoot branch --list 'lane/*' | Write-Output
    exit 0
}

if ($Lane -notmatch '^[a-z0-9][a-z0-9._-]*$') {
    Write-Output ("RESULT=invalid-lane-name lane=" + $Lane + " expected=^[a-z0-9][a-z0-9._-]*$")
    exit 4
}

if (-not $ParentDir) { $ParentDir = Split-Path -Parent $repoRoot }
$repoName = Split-Path -Leaf $repoRoot
$lanePath = Join-Path $ParentDir ($repoName + '-lane-' + $Lane)
$laneBranch = 'lane/' + $Lane

if ($Remove) {
    if (-not (Test-Path -LiteralPath $lanePath) -and -not $DryRun) {
        Write-Output ("RESULT=worktree-not-present path=" + $lanePath)
        exit 5
    }

    Invoke-Git -GitArgs @('worktree', 'remove', $lanePath)

    if ($DryRun) {
        Write-Output 'RESULT=dry-run nothing-was-removed'
        exit 0
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Output 'RESULT=worktree-remove-failed hint=commit-or-discard-changes-inside-the-lane-first'
        exit 6
    }

    Write-Output ("RESULT=worktree-removed path=" + $lanePath)
    Write-Output ("NOTE: branch " + $laneBranch + " was kept. Delete it deliberately with: git -C """ + $repoRoot + """ branch -d " + $laneBranch)
    exit 0
}

& git -C $repoRoot rev-parse --verify --quiet $Base *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Output ("RESULT=base-not-found base=" + $Base + " hint=the-repo-may-have-no-commits-yet")
    exit 7
}

if (Test-Path -LiteralPath $lanePath) {
    Write-Output ("RESULT=lane-path-exists path=" + $lanePath + " hint=use--Remove-or-pick-another-lane-name")
    exit 8
}

$branchExists = (& git -C $repoRoot rev-parse --verify --quiet ('refs/heads/' + $laneBranch)) -and ($LASTEXITCODE -eq 0)
if ($branchExists) {
    Invoke-Git -GitArgs @('worktree', 'add', $lanePath, $laneBranch)
}
else {
    Invoke-Git -GitArgs @('worktree', 'add', '-b', $laneBranch, $lanePath, $Base)
}

if ($DryRun) {
    $branchNote = if ($branchExists) { ' (already exists, would be reused)' } else { ' (would be created)' }

    Write-Output ''
    Write-Output '============ DRY RUN - NOTHING WAS CREATED ============'
    Write-Output ("WOULD CREATE LANE = " + $Lane)
    Write-Output ("WOULD CREATE PATH = " + $lanePath)
    Write-Output ("BRANCH            = " + $laneBranch + $branchNote)
    Write-Output ("BASE              = " + $Base)
    Write-Output '======================================================='
    Write-Output 'RESULT=dry-run'
    exit 0
}

if ($LASTEXITCODE -ne 0) {
    Write-Output 'RESULT=worktree-add-failed'
    exit 9
}

Write-Output ''
Write-Output '================ LANE READY ================'
Write-Output ("LANE        = " + $Lane)
Write-Output ("BRANCH      = " + $laneBranch)
Write-Output ("PATH        = " + $lanePath)
Write-Output ("BASE        = " + $Base)
Write-Output '--------------------------------------------'
Write-Output 'Spawn the lane with projectDir set to PATH above (useWorktree is not needed:'
Write-Output 'this directory already is one).'
Write-Output ''
Write-Output 'When the lane reports, inspect before merging:'
Write-Output ('  git -C "' + $repoRoot + '" diff --stat ' + $Base + '..' + $laneBranch)
Write-Output ('  git -C "' + $repoRoot + '" diff ' + $Base + '..' + $laneBranch)
Write-Output ''
Write-Output 'Then integrate deliberately (never automatically):'
Write-Output ('  git -C "' + $repoRoot + '" merge --no-ff ' + $laneBranch)
Write-Output ('  # or cherry-pick specific commits, or apply a reviewed subset of the diff')
Write-Output ''
Write-Output 'Finally release the lane directory (the branch is kept):'
Write-Output ('  powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\new-lane-worktree.ps1 -Lane ' + $Lane + ' -Remove')
Write-Output '============================================'
Write-Output 'RESULT=lane-created'
exit 0
