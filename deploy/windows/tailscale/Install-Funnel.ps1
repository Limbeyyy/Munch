<#
.SYNOPSIS
    Publishes Munch over HTTPS through Tailscale Funnel.

.DESCRIPTION
    For a machine whose ports 80 and 443 are not reachable and whose
    DNS is managed by somebody else - which rules out every way of
    obtaining a certificate directly.

    Funnel needs neither. The machine makes an outbound connection to
    Tailscale, which terminates TLS at a hostname it owns and forwards
    to a local port. No inbound firewall rule, no port forward, no
    certificate to renew, and websockets pass through - which matters
    here, because the live room, the transcript and the guest hub are
    all websockets.

    What it costs is the name: the site answers at
    <machine>.<tailnet>.ts.net rather than at your own domain.

    That name is what Google is told about, so sign-in works - which
    over plain HTTP it cannot, Google having refused http:// redirect
    URIs for anything but localhost. On this system Google is the only
    way to authenticate an account at all, so this is the difference
    between a usable deployment and one only guests can enter.

.PARAMETER Port
    The local port Munch is listening on.

.EXAMPLE
    .\Install-Funnel.ps1 -Port 8000
#>
[CmdletBinding()]
param(
    [int]    $Port   = 8000,
    [string] $AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
    [string] $Tailscale
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell." }

# -- Find or install Tailscale ---------------------------------------
Write-Step "Tailscale"
if (-not $Tailscale) {
    $onPath = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($onPath) { $Tailscale = $onPath.Source }
    elseif (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') {
        $Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    }
}

if (-not $Tailscale) {
    Write-Note "not installed - fetching the official MSI"
    $msi = Join-Path $env:TEMP 'tailscale-setup.msi'
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' `
        -OutFile $msi
    Write-Note "installing (this takes a minute)"
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait
    Remove-Item $msi -ErrorAction SilentlyContinue
    $Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (-not (Test-Path $Tailscale)) {
        throw "Installed, but tailscale.exe is not where it was expected. Pass -Tailscale C:\path\to\tailscale.exe"
    }
}
Write-Note $Tailscale
& $Tailscale version | Select-Object -First 1 | ForEach-Object { Write-Note $_ }

# -- Join a tailnet --------------------------------------------------
Write-Step "Signing in"
$state = (& $Tailscale status --json 2>$null | ConvertFrom-Json)
if (-not $state -or $state.BackendState -ne 'Running') {
    Write-Note "not signed in - a browser will open to authorise this machine"
    Write-Note "use any Google or Microsoft account; a personal tailnet is free"
    & $Tailscale up
    if ($LASTEXITCODE -ne 0) { throw "tailscale up did not complete." }
    $state = (& $Tailscale status --json | ConvertFrom-Json)
}

# DNSName comes back with a trailing dot, which is correct in DNS and
# wrong in a URL.
$fqdn = ($state.Self.DNSName).TrimEnd('.')
if (-not $fqdn) { throw "Tailscale is running but reports no hostname yet. Try again in a moment." }
Write-Note "this machine is $fqdn"

# -- Publish ----------------------------------------------------------
Write-Step "Opening the funnel to 127.0.0.1:$Port"
# Public side is always 443. Tailscale restricts Funnel to 443, 8443
# and 10000, and 443 is the one that keeps the port out of the URL.
& $Tailscale funnel --bg $Port
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Funnel was refused."
    Write-Note "Usually one of two things, and the output above says which:"
    Write-Note "  * HTTPS certificates are off for this tailnet"
    Write-Note "  * this node is not allowed to use Funnel"
    Write-Note "Both are switches in the admin console - it prints the link."
    Write-Note "  https://login.tailscale.com/admin/dns      (enable HTTPS)"
    Write-Note "  https://login.tailscale.com/admin/settings/keys"
    throw "Funnel not enabled."
}

& $Tailscale funnel status

$origin = "https://$fqdn"

Write-Host @"

  Live at: $origin

  1. Tell Google about it. In the OAuth client at
     https://console.cloud.google.com/apis/credentials
     add this exact Authorised redirect URI:

         $origin/login

  2. In $AppDir\.env.prod:

         ALLOWED_HOSTS=$fqdn,localhost,127.0.0.1
         CSRF_TRUSTED_ORIGINS=$origin
         CORS_ALLOWED_ORIGINS=$origin
         TRUST_PROXY_HEADER=always
         SECURE_SSL_REDIRECT=False

     `always`, not `True`. True means "a proxy in front sets
     X-Forwarded-Proto, believe it"; always means "a proxy in front
     serves HTTPS and nothing else but does not say so", which is
     Funnel. Without it Django builds http:// URLs for uploaded
     images and the browser refuses to load them on an HTTPS page -
     avatars and speaker photographs quietly disappear.

     SECURE_SSL_REDIRECT stays False: Funnel only ever speaks HTTPS,
     so there is no insecure request to redirect and turning it on
     only risks a loop.

  3. Rebuild, so the bundle calls the new origin and sends people to
     the address Google now knows, and bind to loopback - Funnel
     reaches the app from this machine, so nothing else needs to:

         `$env:REACT_APP_API_URL      = '$origin/api/v1'
         `$env:REACT_APP_OAUTH_ORIGIN = '$origin'
         .\deploy\windows\Start-Munch.ps1 -Port $Port -BindHost 127.0.0.1

  To take it down again - the switch is the public port, which is
  always 443, not the local one:

         $Tailscale funnel --https=443 off

"@ -ForegroundColor Gray
