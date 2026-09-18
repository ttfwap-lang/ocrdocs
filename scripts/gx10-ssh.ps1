<#
 Reach the GX10 with automatic fallback. Usage:
   powershell -File scripts/gx10-ssh.ps1 "<remote command>"      run a command
   powershell -File scripts/gx10-ssh.ps1 -Probe                  report which paths work
 Uses the NVIDIA Sync alias `nickgx10` (user/key come from NVIDIA Sync's ssh_config), overriding only the
 network path. Host keys stay verified (StrictHostKeyChecking=yes); nothing here trusts a new key.
 Path order: mDNS name -> LAN IP -> Tailscale IP -> `tailscale ssh`. Override with GX10_PATHS="a,b,c".
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Cmd, [switch]$Probe)
$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
$paths = if ($env:GX10_PATHS) { $env:GX10_PATHS -split "," } else { @("gx10.local", "192.168.4.103", "100.111.170.95") }
$opts = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3")
$remote = ($Cmd -join " ")
if ($Probe) { $remote = "echo ok" }
# Ship the command base64-encoded so quotes, pipes and $vars survive PowerShell + ssh argument re-joining.
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
$remote = "echo $b64 | base64 -d | bash"
foreach ($p in $paths) {
    $out = & $ssh @opts -o "HostName=$p" nickgx10 $remote 2>&1
    if ($LASTEXITCODE -eq 0) {
        if ($Probe) { Write-Output "OK   $p" } else { $out; exit 0 }
        if (-not $Probe) { break }
    } else {
        if ($Probe) { Write-Output "FAIL $p :: $($out | Select-Object -First 1)" }
    }
}
if (-not $Probe) {
    $ts = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($ts) {
        $out = & tailscale ssh nick@gx10 $remote 2>&1
        if ($LASTEXITCODE -eq 0) { $out; exit 0 }
    }
    Write-Error "gx10: all paths failed (mdns, lan, tailscale, tailscale-ssh)"
    exit 1
}
