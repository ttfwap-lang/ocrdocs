<#
resume_ocr_queue.ps1 - run the autonomous OCR queue watcher forever, and survive
reboots & logons via a scheduled task.

The watcher (ocr_queue_watch.py) watches the "queued folder of the ocr folder"
(C:\mnt\nvme\ocr_pipeline\input by default), analyses every page of every file
locally, moves files with no identity/personal/handwriting pages to noocr/, and
sends the rest to LlamaCloud agentic_plus. Only one pass runs per invocation;
this script loops it (allowing it to pick up edits between passes, exactly like
resume_llamacloud.ps1) until stopped.

Usage (PowerShell, first time - key is persisted afterwards):
  powershell -NoProfile -ExecutionPolicy Bypass -File resume_ocr_queue.ps1 -Key "<your key>" -RegisterStartup

  Without -Key it reads LLAMA_CLOUD_API_KEY from your user environment (the
  same persisted key the bulk runner uses).

Stop the watcher (does not stop an in-progress pass):
  powershell -NoProfile -ExecutionPolicy Bypass -File resume_ocr_queue.ps1 -StopLoop
  (creates results\stop.flag; the loop checks it after each pass)

Remove the startup task:
  powershell -NoProfile -ExecutionPolicy Bypass -File resume_ocr_queue.ps1 -UnregisterStartup
#>
param(
  [string]$Key = '',
  [string]$Queue = '',                 # empty => default (C:\mnt\nvme\ocr_pipeline\input)
  [int]$Poll = 30,
  [switch]$RegisterStartup,
  [switch]$UnregisterStartup,
  [switch]$StopLoop
)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path 'results\ocr_queue_watch.log' -Value $line
}

# --- persist settings + key so reboot/startup runs work without typing anything ---
if ($Key) { [Environment]::SetEnvironmentVariable('LLAMA_CLOUD_API_KEY', $Key, 'User'); $env:LLAMA_CLOUD_API_KEY = $Key }
elseif (-not $env:LLAMA_CLOUD_API_KEY) {
  $saved = [Environment]::GetEnvironmentVariable('LLAMA_CLOUD_API_KEY', 'User')
  if ($saved) { $env:LLAMA_CLOUD_API_KEY = $saved } else { Log 'STOP: no LLAMA_CLOUD_API_KEY. Pass -Key "<key>" once (it is then persisted).'; exit 2 }
}
[Environment]::SetEnvironmentVariable('OCRDOCS_LLAMAPARSE', 'full', 'User'); $env:OCRDOCS_LLAMAPARSE = 'full'
[Environment]::SetEnvironmentVariable('OCRDOCS_LLAMAPARSE_TIER', 'agentic_plus', 'User'); $env:OCRDOCS_LLAMAPARSE_TIER = 'agentic_plus'
if ($Queue) { [Environment]::SetEnvironmentVariable('OCR_QUEUE_DIR', $Queue, 'User'); $env:OCR_QUEUE_DIR = $Queue }

# --- scheduled task so a reboot + logon resumes automatically ---
$TaskName = 'ocrdocs_ocr_queue_watch'
if ($UnregisterStartup) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Log "removed startup task '$TaskName'"
  exit 0
}
if ($RegisterStartup) {
  $cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'resume_ocr_queue.ps1') + '"'
  schtasks /Create /TN $TaskName /TR $cmd /SC ONLOGON /F | Out-Null
  Log "startup task '$TaskName' installed: after any reboot, log in and the OCR queue watcher resumes automatically"
}

$stopFlag = Join-Path $PSScriptRoot 'results\stop.flag'
if ($StopLoop) {
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'results') | Out-Null
  Set-Content -Path $stopFlag -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Log "stop flag written: $stopFlag (the running loop will exit after its current pass)"
  exit 0
}

# --- loop the watcher forever ---
$cmd = 'python'
$watchArgs = @('ocr_queue_watch.py')
Log "starting OCR queue watch loop (poll=$Poll s); ctrl-C or stop.flag exits"
while ($true) {
  if (Test-Path $stopFlag) {
    Log "stop flag present - exiting loop"
    Remove-Item $stopFlag -ErrorAction SilentlyContinue
    exit 0
  }
  & $cmd @watchArgs --once --poll $Poll 2>&1 | ForEach-Object { $line = $_; if ($line) { Write-Host $line } }
  Start-Sleep -Seconds 3
}