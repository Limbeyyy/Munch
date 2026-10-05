<#
.SYNOPSIS
    Puts Caddy in front of Munch, with automatic HTTPS.

.DESCRIPTION
    Downloads caddy.exe, writes the site config, registers it as a
    Windows service, and opens the two ports a certificate needs.

    Caddy obtains a certificate from Let's Encrypt the first time it
    starts and renews it on its own. Two things have to be true first,
    and neither can be arranged from this machine:

      * the hostname resolves to this machine's public address
      * ports 80 and 443 reach it from the internet

    Port 80 is not optional. It answers the HTTP-01 challenge, both
    now and at every renewal.

.PARAMETER Hostname
    The name the certificate is for. Must already resolve here.

.PARAMETER AppDir
    Where the repository is checked out.

.PARAMETER Nssm
    Path to nssm.exe - https://nssm.cc/download, win64 build.

.EXAMPLE
    .\Install-Caddy.ps1 -Hostname munch.example.np -Nssm C:\tools\nssm.exe
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Hostname,
    [string] $AppDir      = 'C:\munch',
    [string] $CaddyDir    = 'C:\caddy',
    [string] $Nssm        = 'nssm.exe',
    [int]    $UpstreamPort = 8000
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell." }
if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue)) {
    throw "nssm.exe not found. https://nssm.cc/download, or pass -Nssm C:\path\to\nssm.exe"
}

Write-Step "Checking the name"
try {
    $resolved = (Resolve-DnsName $Hostname -Type A -ErrorAction Stop |
                 Where-Object { $_.IPAddress }).IPAddress
    Write-Note "$Hostname -> $($resolved -join ', ')"
} catch {
    Write-Warn "$Hostname does not resolve. Caddy will keep retrying, but no certificate will be issued until it does."
}

Write-Step "Downloading Caddy"
New-Item -ItemType Directory -Force -Path $CaddyDir | Out-Null
$exe = Join-Path $CaddyDir 'caddy.exe'
if (-not (Test-Path $exe)) {
    $zip = Join-Path $env:TEMP 'caddy.zip'
    # The official build service. Pinned to a major version rather than
    # "latest" so a reinstall six months from now is the same binary.
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://caddyserver.com/api/download?os=windows&arch=amd64' `
        -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $CaddyDir -Force
    Remove-Item $zip
}
& $exe version

Write-Step "Writing the site config"
$template = Join-Path $AppDir 'deploy\windows\caddy\Caddyfile'
if (-not (Test-Path $template)) { throw "Missing $template" }

# Forward slashes: Caddy accepts them on Windows, and a backslash in a
# Caddyfile starts an escape sequence.
$appPath = $AppDir -replace '\\', '/'
$config  = Get-Content $template -Raw
$config  = $config -replace 'munch\.example\.np', $Hostname
$config  = $config -replace 'C:/munch', $appPath
$config  = $config -replace '127\.0\.0\.1:8000', "127.0.0.1:$UpstreamPort"

$caddyfile = Join-Path $CaddyDir 'Caddyfile'
Set-Content -Path $caddyfile -Value $config -Encoding UTF8
Write-Note $caddyfile

& $exe validate --config $caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw "Caddy rejected the config." }

Write-Step "Opening 80 and 443"
foreach ($port in 80, 443) {
    $name = "Caddy TCP $port"
    if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $name -Direction Inbound `
            -Action Allow -Protocol TCP -LocalPort $port | Out-Null
    }
}
# Nothing outside should reach the application server directly - it
# speaks plain HTTP and would answer on whatever Host it was given.
Get-NetFirewallRule -DisplayName "Munch" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
Write-Note "Removed any rule publishing port $UpstreamPort, if one existed."

Write-Step "Registering the service"
if (Get-Service -Name Caddy -ErrorAction SilentlyContinue) {
    & $Nssm stop Caddy confirm 2>$null | Out-Null
    & $Nssm remove Caddy confirm 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
}
& $Nssm install Caddy $exe "run --config `"$caddyfile`" --adapter caddyfile" | Out-Null
& $Nssm set Caddy AppDirectory $CaddyDir                         | Out-Null
& $Nssm set Caddy Description "Caddy - TLS and reverse proxy for Munch" | Out-Null
& $Nssm set Caddy Start SERVICE_AUTO_START                        | Out-Null
& $Nssm set Caddy AppStdout (Join-Path $CaddyDir 'caddy.out.log') | Out-Null
& $Nssm set Caddy AppStderr (Join-Path $CaddyDir 'caddy.err.log') | Out-Null
& $Nssm set Caddy AppRotateFiles 1                                | Out-Null
& $Nssm set Caddy AppExit Default Restart                         | Out-Null
& $Nssm start Caddy | Out-Null

Start-Sleep -Seconds 5
Write-Host "    Caddy: $((Get-Service Caddy).Status)" -ForegroundColor Green

Write-Host @"

  Now, in C:\munch\.env.prod:

      ALLOWED_HOSTS=$Hostname
      CSRF_TRUSTED_ORIGINS=https://$Hostname
      CORS_ALLOWED_ORIGINS=https://$Hostname
      TRUST_PROXY_HEADER=True
      SECURE_SSL_REDIRECT=True

  Then rebuild, so the bundle calls the new origin, and bind the
  application server to loopback - Caddy is what the internet talks to:

      `$env:REACT_APP_API_URL = 'https://$Hostname/api/v1'
      .\deploy\windows\Start-Munch.ps1 -BindHost 127.0.0.1

  The first certificate takes up to a minute. Watch it:

      Get-Content $CaddyDir\caddy.err.log -Wait -Tail 30

"@ -ForegroundColor Gray
