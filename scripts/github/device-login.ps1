<#
.SYNOPSIS
  Logs GitHub CLI in using the OAuth device flow, then hands the token to `gh`.

.DESCRIPTION
  Prints a one-time user code and verification URL, opens the browser, then polls GitHub
  until the code is approved, denied or expires. The access token is never printed; it is
  piped straight into `gh auth login --with-token`.

  Client ID is the public GitHub CLI OAuth app, so the granted access appears in the
  account's authorised apps and can be revoked there at any time.
#>
[CmdletBinding()]
param(
    [string]$ClientId = '178c6fc778ccc68e1d6a',
    [string]$Scopes = 'repo read:org gist workflow',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Resolve-Gh {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $fallback = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }
    throw 'GitHub CLI not found. Install with: winget install --id GitHub.cli --exact --silent'
}

$gh = Resolve-Gh

$headers = @{ Accept = 'application/json'; 'User-Agent' = 'ocrdocs-setup' }

$device = Invoke-RestMethod -Method Post -Uri 'https://github.com/login/device/code' -Headers $headers -Body @{
    client_id = $ClientId
    scope     = $Scopes
} -TimeoutSec 30

Write-Output '================ GITHUB DEVICE LOGIN ================'
Write-Output ("VERIFICATION_URL = " + $device.verification_uri)
Write-Output ("USER_CODE        = " + $device.user_code)
Write-Output ("EXPIRES_IN_SEC   = " + $device.expires_in)
Write-Output ("SCOPES           = " + $Scopes)
Write-Output '====================================================='
Write-Output 'Waiting for approval...'

if (-not $NoBrowser) {
    try { Start-Process $device.verification_uri | Out-Null } catch { Write-Output 'Could not open browser automatically.' }
}

$interval = [int]$device.interval
if ($interval -lt 5) { $interval = 5 }
$deadline = (Get-Date).AddSeconds([int]$device.expires_in)
$token = $null

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $interval

    $response = Invoke-RestMethod -Method Post -Uri 'https://github.com/login/oauth/access_token' -Headers $headers -Body @{
        client_id   = $ClientId
        device_code = $device.device_code
        grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
    } -TimeoutSec 30

    if ($response.access_token) { $token = $response.access_token; break }

    switch ($response.error) {
        'authorization_pending' { continue }
        'slow_down' { $interval = $interval + 5; continue }
        'expired_token' { Write-Output 'RESULT=code-expired'; exit 5 }
        'access_denied' { Write-Output 'RESULT=access-denied'; exit 6 }
        default { Write-Output ('RESULT=oauth-error error=' + $response.error); exit 7 }
    }
}

if (-not $token) { Write-Output 'RESULT=timeout-waiting-for-approval'; exit 8 }

Write-Output 'Approval received; storing token in GitHub CLI...'
$token | & $gh auth login --hostname github.com --git-protocol https --with-token
if ($LASTEXITCODE -ne 0) { Write-Output 'RESULT=gh-auth-login-failed'; exit 9 }
$token = $null

& $gh auth setup-git --hostname github.com
if ($LASTEXITCODE -ne 0) { Write-Output 'RESULT=gh-auth-setup-git-failed'; exit 10 }

& $gh auth status
Write-Output 'RESULT=authenticated'
