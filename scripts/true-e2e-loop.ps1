<#
.SYNOPSIS
  Forwarding wrapper for true-e2e-loop.ps1
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

$targetScript = Join-Path $PSScriptRoot '..\.junie\skills\true-e2e\scripts\true-e2e-loop.ps1'
& $targetScript @PSBoundParameters
exit $LASTEXITCODE
