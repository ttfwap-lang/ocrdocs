<#
.SYNOPSIS
  Installs the autonomy setup (autonomy-core + max-throughput + true-e2e, the agent roles, the
  core documents and the automation plane) into a target project.

.DESCRIPTION
  Idempotent by design. Skill and agent definitions are refreshed from this repository, because
  they are guidance and must not drift. Project documents (RULES.md, PROJECT_CHARTER.md,
  STATE.md, docs/ACCEPTANCE_REGISTER.md, .junie/guidelines.md) are only *seeded* when missing -
  an existing one is never overwritten without -Force, so the installer can never destroy a
  project's real rules or roadmap.

  Nothing is deleted. Nothing outside -TargetRoot is written. With -DryRun the script writes
  nothing at all and prints the exact plan with a per-item action.

  Placeholders rendered into the seeded documents:
    {{PROJECT_NAME}} {{GATE_COMMANDS_BLOCK}} {{GATE_COMMANDS_INLINE}} {{STAGE_COUNT}}
    {{RUNTIME_HOURS}} {{OFFLIMITS_CLAUSE}} {{STATE_SECRETS_EXTRA}}

.PARAMETER TargetRoot
  Project root to install into. Created if it does not exist (unless -DryRun).

.PARAMETER ProjectName
  Name used in the seeded documents. Default: the target folder name.

.PARAMETER GateCommands
  The project's real verification commands, e.g. 'npm run lint','npm test','npm run build'.
  If omitted, they are detected from the target's manifests; if nothing is detected, the
  documents are seeded with a TODO marker and the installer says so - it never invents a
  command that does not exist.

.PARAMETER StageCount
  Number of stages the charter is expected to hold. Default 10.

.PARAMETER RuntimeHours
  Bounded runtime per unattended window recorded in RULES.md. Default 72.

.PARAMETER OffLimitsPaths
  Paths that must never be opened, copied or quoted (and are gitignored), e.g. 'Recovered_C/'.

.PARAMETER Force
  Overwrite existing project documents as well. Use only deliberately.

.PARAMETER DryRun
  Print the plan and write nothing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .junie\skills\autonomy-core\scripts\install-autonomy-core.ps1 -TargetRoot C:\proj -DryRun

.EXAMPLE
  powershell -ExecutionPolicy Bypass -Command "& .junie\skills\autonomy-core\scripts\install-autonomy-core.ps1 -TargetRoot C:\proj -GateCommands 'npm run lint','npm test'"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetRoot,
    [string]$ProjectName,
    [string[]]$GateCommands,
    [int]$StageCount = 10,
    [int]$RuntimeHours = 72,
    [string[]]$OffLimitsPaths,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$skillRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$junieRoot = (Resolve-Path (Join-Path $skillRoot '..\..')).Path
$sourceRoot = (Resolve-Path (Join-Path $junieRoot '..')).Path

if (-not (Test-Path -LiteralPath (Join-Path $junieRoot 'skills\autonomy-core\SKILL.md'))) {
    Write-Output "RESULT=source-not-found probed=$junieRoot"
    exit 2
}

$targetFull = [System.IO.Path]::GetFullPath($TargetRoot)
if ($targetFull.TrimEnd('\') -eq $sourceRoot.TrimEnd('\')) {
    Write-Output 'RESULT=target-is-source The setup is already installed here; nothing to do.'
    exit 4
}

if (-not $ProjectName) {
    $ProjectName = Split-Path -Leaf $targetFull.TrimEnd('\')
}

$actions = @()
function Add-Action {
    param([string]$Kind, [string]$Path, [string]$Decision, [string]$Note = '')
    $script:actions += [pscustomobject]@{ Kind = $Kind; Path = $Path; Decision = $Decision; Note = $Note }
}

function New-TargetDirectory {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) { return }
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}

function Copy-GuidanceTree {
    param([string]$RelativePath)

    $source = Join-Path $junieRoot $RelativePath
    $destination = Join-Path $targetFull (Join-Path '.junie' $RelativePath)

    if (-not (Test-Path -LiteralPath $source)) {
        Add-Action -Kind 'guidance' -Path (".junie\" + $RelativePath) -Decision 'missing-in-source' -Note 'skipped'
        return
    }

    $decision = if (Test-Path -LiteralPath $destination) { 'refresh' } else { 'create' }
    Add-Action -Kind 'guidance' -Path (".junie\" + $RelativePath) -Decision $decision

    if ($DryRun) { return }

    # The destination folder is created first and the source *contents* are copied into it.
    # Copying the folder itself onto an existing folder would nest it one level deeper.
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
}

function Resolve-GateCommands {
    if ($GateCommands -and $GateCommands.Count -gt 0) { return , @($GateCommands) }

    $detected = @()
    $packageJson = Join-Path $targetFull 'package.json'
    if (Test-Path -LiteralPath $packageJson) {
        try {
            $parsed = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
            if ($parsed.scripts) {
                foreach ($name in @('lint', 'typecheck', 'test', 'build')) {
                    if ($parsed.scripts.PSObject.Properties.Name -contains $name) {
                        if ($name -eq 'test') { $detected += 'npm test' } else { $detected += "npm run $name" }
                    }
                }
            }
        }
        catch { }
    }
    if (Test-Path -LiteralPath (Join-Path $targetFull 'Cargo.toml')) {
        $detected += @('cargo build --locked', 'cargo test --locked')
    }
    return , @($detected | Select-Object -Unique)
}

function New-SeededDocument {
    param([string]$TemplateName, [string]$RelativeTarget, [hashtable]$Tokens)

    $templatePath = Join-Path $skillRoot (Join-Path 'templates' $TemplateName)
    $destination = Join-Path $targetFull $RelativeTarget
    $exists = Test-Path -LiteralPath $destination

    if (-not (Test-Path -LiteralPath $templatePath)) {
        Add-Action -Kind 'document' -Path $RelativeTarget -Decision 'template-missing' -Note $TemplateName
        return
    }
    if ($exists -and -not $Force) {
        Add-Action -Kind 'document' -Path $RelativeTarget -Decision 'keep-existing' -Note 'use -Force to replace'
        return
    }

    $decision = if ($exists) { 'overwrite(-Force)' } else { 'create' }
    Add-Action -Kind 'document' -Path $RelativeTarget -Decision $decision

    if ($DryRun) { return }

    $content = Get-Content -LiteralPath $templatePath -Raw
    foreach ($key in $Tokens.Keys) {
        $content = $content.Replace('{{' + $key + '}}', [string]$Tokens[$key])
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Set-Content -LiteralPath $destination -Value $content -Encoding UTF8
}

function Add-GitignoreEntries {
    param([string[]]$Entries)

    $destination = Join-Path $targetFull '.gitignore'
    $existing = @()
    if (Test-Path -LiteralPath $destination) {
        $existing = @(Get-Content -LiteralPath $destination)
    }

    $missing = @($Entries | Where-Object { $existing -notcontains $_ })
    if ($missing.Count -eq 0) {
        Add-Action -Kind 'gitignore' -Path '.gitignore' -Decision 'already-complete'
        return
    }

    Add-Action -Kind 'gitignore' -Path '.gitignore' -Decision 'append' -Note ($missing -join ' ')
    if ($DryRun) { return }

    $block = @()
    if ($existing.Count -gt 0) { $block += '' }
    $block += '# autonomy-core: evidence and off-limits paths'
    $block += $missing
    Add-Content -LiteralPath $destination -Value ($block -join [Environment]::NewLine)
}

# ---------------------------------------------------------------- plan and execute

$gate = Resolve-GateCommands
$gateInline = if ($gate.Count -gt 0) { ($gate | ForEach-Object { '`' + $_ + '`' }) -join ', ' } else { '`<TODO: the project''s real check commands>`' }
$gateBlock = if ($gate.Count -gt 0) { ($gate -join [Environment]::NewLine) } else { '<TODO: the project''s real check commands>' }
$offLimitsClause = if ($OffLimitsPaths -and $OffLimitsPaths.Count -gt 0) {
    'Off-limits paths are never opened, copied or quoted: ' + (($OffLimitsPaths | ForEach-Object { '`' + $_ + '`' }) -join ', ') + '.'
}
else { 'No off-limits paths declared for this project.' }
$secretsExtra = if ($OffLimitsPaths -and $OffLimitsPaths.Count -gt 0) { ' or off-limits content' } else { '' }

$tokens = @{
    'PROJECT_NAME'         = $ProjectName
    'GATE_COMMANDS_BLOCK'  = $gateBlock
    'GATE_COMMANDS_INLINE' = $gateInline
    'STAGE_COUNT'          = $StageCount
    'RUNTIME_HOURS'        = $RuntimeHours
    'OFFLIMITS_CLAUSE'     = $offLimitsClause
    'STATE_SECRETS_EXTRA'  = $secretsExtra
}

Write-Output '=========== INSTALL AUTONOMY CORE ==========='
Write-Output ("SOURCE       = " + $sourceRoot)
Write-Output ("TARGET       = " + $targetFull)
Write-Output ("PROJECT_NAME = " + $ProjectName)
Write-Output ("GATE         = " + $(if ($gate.Count -gt 0) { $gate -join ' | ' } else { '(none detected - TODO seeded)' }))
Write-Output ("MODE         = " + $(if ($DryRun) { 'dry-run (writes nothing)' } else { 'install' }) + $(if ($Force) { ' +force' } else { '' }))
Write-Output '============================================='

if (-not (Test-Path -LiteralPath $targetFull)) {
    Add-Action -Kind 'directory' -Path '.' -Decision 'create-target-root'
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $targetFull | Out-Null }
}

foreach ($relative in @('.junie', '.junie\skills', '.junie\agents', 'docs', 'automation', 'automation\runs', 'automation\true-e2e')) {
    $path = Join-Path $targetFull $relative
    if (-not (Test-Path -LiteralPath $path)) {
        Add-Action -Kind 'directory' -Path $relative -Decision 'create'
        New-TargetDirectory -Path $path
    }
}

Copy-GuidanceTree -RelativePath 'skills\autonomy-core'
Copy-GuidanceTree -RelativePath 'skills\max-throughput'
Copy-GuidanceTree -RelativePath 'skills\true-e2e'
Copy-GuidanceTree -RelativePath 'agents'

New-SeededDocument -TemplateName 'guidelines.md.tmpl' -RelativeTarget '.junie\guidelines.md' -Tokens $tokens
New-SeededDocument -TemplateName 'RULES.md.tmpl' -RelativeTarget 'RULES.md' -Tokens $tokens
New-SeededDocument -TemplateName 'PROJECT_CHARTER.md.tmpl' -RelativeTarget 'PROJECT_CHARTER.md' -Tokens $tokens
New-SeededDocument -TemplateName 'STATE.md.tmpl' -RelativeTarget 'STATE.md' -Tokens $tokens
New-SeededDocument -TemplateName 'ACCEPTANCE_REGISTER.md.tmpl' -RelativeTarget 'docs\ACCEPTANCE_REGISTER.md' -Tokens $tokens

$ignoreEntries = @('automation/runs/', 'automation/STOP', 'automation/runner.lock')
if ($OffLimitsPaths) { $ignoreEntries += $OffLimitsPaths }
Add-GitignoreEntries -Entries $ignoreEntries

Write-Output ''
Write-Output '------------------- PLAN --------------------'
$actions | Format-Table -AutoSize Kind, Decision, Path, Note | Out-String -Width 160 | Write-Output

$problems = @($actions | Where-Object { $_.Decision -in @('missing-in-source', 'template-missing') })

Write-Output '------------------ NEXT ---------------------'
Write-Output '1. Fill PROJECT_CHARTER.md with real stages: goal, scope, acceptance evidence, tests, external gates.'
if ($gate.Count -eq 0) {
    Write-Output '2. Replace the TODO gate marker in .junie\guidelines.md and RULES.md with the project''s real check commands.'
}
else {
    Write-Output ('2. Confirm the gate really fails when it should: ' + ($gate -join ' | '))
}
Write-Output '3. Work .junie\skills\autonomy-core\checklists\install-verification.md top to bottom.'
Write-Output '4. Then start the stage loop with the true-e2e skill.'
Write-Output ''

if ($problems.Count -gt 0) {
    Write-Output ("RESULT=install-incomplete problems=" + $problems.Count + " dry_run=" + [bool]$DryRun)
    exit 1
}

Write-Output ("RESULT=" + $(if ($DryRun) { 'dry-run-ok' } else { 'install-ok' }) + " actions=" + $actions.Count)
exit 0
