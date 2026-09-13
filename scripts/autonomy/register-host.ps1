param(
    [ValidatePattern('^OCRDocs-Autonomy-[A-Za-z0-9-]+$')][string]$TaskName = 'OCRDocs-Autonomy-72h-20260913'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'automation\host-handoff.json'))) {
    throw 'Run the verified host preparation before registering this task.'
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    throw 'A task with this name already exists; it will not be overwritten.'
}
$Node = (Get-Command node -ErrorAction Stop).Source
$Action = New-ScheduledTaskAction -Execute $Node -Argument ('"{0}"' -f (Join-Path $PSScriptRoot 'host.mjs')) -WorkingDirectory $ProjectRoot
$Principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 72) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $Principal -Settings $Settings -Description 'OCRDocs bounded autonomous host; existing user, original checkpoint deadline, no elevated privileges, no recurring trigger' | Format-Table TaskName, State
Start-ScheduledTask -TaskName $TaskName
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult