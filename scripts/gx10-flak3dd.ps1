<#
 Run commands on the GX10 as `flak3dd` without the password ever living in the repo, a script, or a chat.
   powershell -File scripts/gx10-flak3dd.ps1 -Save                 store the password (run this yourself, in your own terminal)
   powershell -File scripts/gx10-flak3dd.ps1 "<remote command>"    run a command as flak3dd
   powershell -File scripts/gx10-flak3dd.ps1 -Probe                check the stored password still logs in
 The password is kept in %USERPROFILE%\.gx10\flak3dd.cred, encrypted with Windows DPAPI: only this Windows user on this
 machine can decrypt it. It is loaded into an environment variable for the single ssh process, then removed.
 Host keys stay verified (StrictHostKeyChecking=yes). Path order matches gx10-ssh.ps1.
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Cmd, [switch]$Save, [switch]$Probe)
$dir = Join-Path $env:USERPROFILE ".gx10"
$credFile = Join-Path $dir "flak3dd.cred"
$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"

if ($Save) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    $pw = Read-Host "flak3dd password" -AsSecureString
    [pscredential]::new("flak3dd", $pw) | Export-Clixml -Path $credFile
    Write-Output "Saved (DPAPI-encrypted) to $credFile. Verifying login..."
    $Probe = $true
}
if (-not (Test-Path $credFile)) { Write-Error "No stored password. Run: powershell -File scripts/gx10-flak3dd.ps1 -Save"; exit 1 }

$cred = Import-Clixml -Path $credFile
$askpass = Join-Path $env:TEMP "gx10-askpass.cmd"
Set-Content -Path $askpass -Value '@echo %GX10_PW%' -Encoding ascii   # prints the env var; contains no secret itself
$remote = if ($Probe) { "echo ok" } else { $Cmd -join " " }
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
$remote = "echo $b64 | base64 -d | bash"
$opts = @("-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=yes", "-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no")
$code = 1
try {
    $env:GX10_PW = $cred.GetNetworkCredential().Password
    $env:SSH_ASKPASS = $askpass; $env:SSH_ASKPASS_REQUIRE = "force"; $env:DISPLAY = "x"
    foreach ($p in @("gx10.local", "192.168.4.103", "100.111.170.95")) {
        $out = & $ssh @opts -o "HostName=$p" flak3dd@gx10.local $remote 2>&1
        if ($LASTEXITCODE -eq 0) {
            if ($Probe) { Write-Output "OK   flak3dd via $p" } else { $out }
            $code = 0; break
        }
        if ($Probe) { Write-Output "FAIL $p :: $($out | Select-Object -First 1)" }
    }
} finally {
    Remove-Item Env:GX10_PW, Env:SSH_ASKPASS, Env:SSH_ASKPASS_REQUIRE, Env:DISPLAY -ErrorAction SilentlyContinue
}
if ($code -ne 0 -and -not $Probe) { Write-Error "gx10 flak3dd: all paths failed" }
exit $code
