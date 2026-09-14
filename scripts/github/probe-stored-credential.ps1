# Temporary probe: reads the current user's stored generic credential and tests whether it is a
# usable GitHub token. The secret is never printed; only the validation outcome is reported.
[CmdletBinding()]
param(
    [string]$Target = 'workbench:Github-credential'
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name CredMan -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);

[StructLayout(LayoutKind.Sequential)]
public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
}
'@

$ptr = [IntPtr]::Zero
if (-not [Win32.CredMan]::CredRead($Target, 1, 0, [ref]$ptr)) {
    Write-Output 'RESULT=credential-not-readable'
    exit 2
}

try {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.CredMan+CREDENTIAL])
    $secret = ''
    if ($cred.CredentialBlobSize -gt 0) {
        $secret = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
    }
}
finally {
    [Win32.CredMan]::CredFree($ptr)
}

if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Output 'RESULT=empty-secret'
    exit 3
}

Write-Output ('SECRET_LENGTH=' + $secret.Length)
Write-Output ('LOOKS_LIKE_GITHUB_TOKEN=' + ($secret -match '^(gh[pousr]_|github_pat_)'))

try {
    $response = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers @{
        Authorization          = "Bearer $secret"
        'User-Agent'           = 'ocrdocs-setup'
        'X-GitHub-Api-Version' = '2022-11-28'
    } -Method Get -TimeoutSec 20
    Write-Output ('RESULT=valid-token login=' + $response.login)
    exit 0
}
catch {
    Write-Output ('RESULT=token-rejected detail=' + $_.Exception.Message)
    exit 4
}
