<#
.SYNOPSIS
  Authenticates GitHub CLI (if needed) and creates the remote repository for this project.

.DESCRIPTION
  The local git repository and first commit already exist. This script only handles the
  remote side: authentication, repository creation and the first push.

  Authentication order:
    1. $env:GH_TOKEN / $env:GITHUB_TOKEN, if set (fully non-interactive).
    2. Otherwise `gh auth login --web`, which requires a one-time browser confirmation.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\github\create-repo.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\github\create-repo.ps1 -Name ocrdocs -Visibility public
#>
[CmdletBinding()]
param(
    [string]$Name = 'ocrdocs',
    [ValidateSet('private', 'public', 'internal')]
    [string]$Visibility = 'private',
    [string]$Description = 'Australian banking document OCR extraction, validation and review workflow'
)

$ErrorActionPreference = 'Stop'

function Resolve-Gh {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $fallback = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }
    throw 'GitHub CLI not found. Install it with: winget install --id GitHub.cli --exact --silent'
}

$gh = Resolve-Gh
Write-Host "Using $gh"

& $gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    $token = if ($env:GH_TOKEN) { $env:GH_TOKEN } elseif ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } else { $null }
    if ($token) {
        $token | & $gh auth login --hostname github.com --git-protocol https --with-token
        if ($LASTEXITCODE -ne 0) { throw 'Token authentication failed.' }
    }
    else {
        Write-Host 'No GH_TOKEN/GITHUB_TOKEN found; starting browser login (one-time interactive step).'
        & $gh auth login --hostname github.com --git-protocol https --web
        if ($LASTEXITCODE -ne 0) { throw 'Interactive authentication failed.' }
    }
}

& $gh auth setup-git --hostname github.com
if ($LASTEXITCODE -ne 0) { throw 'gh auth setup-git failed.' }

if (-not (git rev-parse --is-inside-work-tree 2>$null)) { throw 'Run this script from the project root.' }
if ((git status --porcelain).Count -gt 0) {
    Write-Warning 'Working tree has uncommitted changes; they will not be pushed.'
}

$existingRemote = git remote get-url origin 2>$null
if ($existingRemote) {
    Write-Host "Remote origin already configured: $existingRemote"
    git push -u origin (git rev-parse --abbrev-ref HEAD)
}
else {
    & $gh repo create $Name "--$Visibility" --source . --remote origin --description $Description --push
    if ($LASTEXITCODE -ne 0) { throw 'gh repo create failed.' }
}

& $gh repo view --json nameWithOwner,visibility,url
