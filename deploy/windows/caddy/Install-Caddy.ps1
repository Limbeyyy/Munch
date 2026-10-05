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
    The domain name the certificate is for, and it must be a domain -
    a public CA cannot certify an IP address, because it has no way to
    verify one belongs to you and no way to reach a private one at
    all. It must already resolve to this machine's public address.

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
    [string] $AppDir      = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
    [string] $CaddyDir    = 'C:\caddy',
    [string] $Nssm        = 'nssm.exe',
    [int]    $UpstreamPort = 8000,

    # For a machine where port 80 cannot be had. Windows reserves it
    # readily - IIS, or anything else registered with HTTP.sys, or a
    # kernel port exclusion that survives stopping the service that
    # caused it. Check with:
    #     netsh int ipv4 show excludedportrange protocol=tcp
    #
    # The certificate is then obtained over TLS-ALPN-01, which is
    # answered inside the TLS handshake on 443 and needs nothing on
    # 80, at issue or at renewal. The cost is the HTTP->HTTPS
    # redirect: somebody typing http://... reaches nothing, because
    # nothing is listening there to redirect them.
    [switch] $NoPort80,

    # -- DNS-01, for a machine whose 80 and 443 are not reachable ------
    #
    # Let's Encrypt validates on port 80 or on port 443 and nowhere
    # else; the ports are fixed by the ACME specification, so serving
    # on 8090 does not move them. Where an ISP blocks both - which is
    # ordinary on a business line - the only remaining proof is a DNS
    # record, and that needs no inbound connection at all.
    #
    # The snag is that the record has to be written automatically at
    # renewal, and most DNS hosts offer no API for it. So the one
    # record ACME looks at is delegated, once and by hand, to a
    # service that does: a CNAME from
    # _acme-challenge.<your domain> to an acme-dns account. Nothing
    # else about your DNS moves, and the delegation is permanent.
    [switch] $AcmeDns,

    # Where the delegated account lives. The public instance is run by
    # acme-dns's author and holds nothing but challenge tokens for a
    # name that exists only to carry them. Self-host it by pointing
    # this elsewhere - though that needs inbound UDP 53, which is the
    # problem this is working around.
    [string] $AcmeDnsServer = 'https://auth.acme-dns.io',

    # What the site listens on. 443 by default; with -AcmeDns it is
    # usually a high port, because 443 is the one that is blocked.
    [int]    $ListenPort = 443
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell." }
# NSSM turns a console program into a Windows service, which is the
# only reason it is here - Windows has no systemd, and `sc create`
# wants a binary that talks to the service manager, which neither
# Caddy nor Python does.
#
# Fetched rather than demanded. It is a single executable in a zip,
# and stopping to say so only to be told again in a minute wastes a
# step; Caddy itself is downloaded a few lines below on the same
# reasoning.
# Where it already is, before deciding it is missing. The default is
# the bare name 'nssm.exe', and C:\tools is not on PATH - so
# Get-Command alone said "absent" about a file sitting exactly where
# this script had put it, tried to download over the top, and failed
# because the running Caddy service was holding it open.
if ($Nssm -eq 'nssm.exe') {
    $here = Join-Path $CaddyDir 'nssm.exe'
    foreach ($candidate in @('C:\tools\nssm.exe', $here)) {
        if (Test-Path $candidate) { $Nssm = $candidate; break }
    }
}

if (-not (Test-Path $Nssm) -and -not (Get-Command $Nssm -ErrorAction SilentlyContinue)) {
    Write-Step "Fetching NSSM"
    $tools = Split-Path -Parent $Nssm
    if (-not $tools) { $tools = 'C:\tools'; $Nssm = Join-Path $tools 'nssm.exe' }
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    try {
        $zip = Join-Path $env:TEMP 'nssm.zip'
        $out = Join-Path $env:TEMP 'nssm-extract'
        Invoke-WebRequest -UseBasicParsing `
            -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $out -Force
        # 2.24 is the current release and has been since 2014; the
        # win64 build is the one to take on any modern machine.
        Copy-Item (Join-Path $out 'nssm-2.24\win64\nssm.exe') $Nssm -Force
        Remove-Item $zip, $out -Recurse -Force -ErrorAction SilentlyContinue
        Write-Note $Nssm
    } catch {
        throw ("Could not fetch NSSM: $($_.Exception.Message)`n" +
               "     Download it by hand from https://nssm.cc/download - the win64 " +
               "nssm.exe - and pass -Nssm C:\path\to\nssm.exe")
    }
}
if (-not (Test-Path $Nssm) -and -not (Get-Command $Nssm -ErrorAction SilentlyContinue)) {
    throw "nssm.exe still not found at $Nssm."
}
Write-Note "nssm: $Nssm"

# A certificate is for a name, so a URL is not an answer - but it is
# the obvious thing to paste, and Caddy's failure if one gets through
# is about parsing a site address rather than about this. Taken apart
# here instead.
$given = $Hostname
$Hostname = ($Hostname -replace '^[a-zA-Z][a-zA-Z0-9+.-]*://', '') -replace '/.*$', ''
$Hostname = ($Hostname -split ':')[0].Trim().TrimEnd('.')
if ($Hostname -ne $given) { Write-Warn "Read '$given' as '$Hostname'." }

if ($Hostname -match '^\d{1,3}(\.\d{1,3}){3}$') {
    throw ("'$Hostname' is an address, not a name. A public certificate authority " +
           "certifies a name it can verify you control, and it can do that for " +
           "neither a public address nor a private one. Use a domain that resolves " +
           "here - a free DuckDNS or No-IP name will do - or serve over plain HTTP " +
           "on the local network and skip this.")
}

Write-Step "Checking the name"
try {
    $resolved = (Resolve-DnsName $Hostname -Type A -ErrorAction Stop |
                 Where-Object { $_.IPAddress }).IPAddress
    Write-Note "$Hostname -> $($resolved -join ', ')"
} catch {
    Write-Warn "$Hostname does not resolve. Caddy will keep retrying, but no certificate will be issued until it does."
}

# -- The delegated account -------------------------------------------
$acme = $null
if ($AcmeDns) {
    $store = Join-Path $CaddyDir 'acmedns.json'

    if (Test-Path $store) {
        $acme = Get-Content $store -Raw | ConvertFrom-Json
        Write-Step "Using the existing acme-dns account"
    } else {
        Write-Step "Registering an acme-dns account"
        # Anonymous and free: the account owns one meaningless
        # hostname whose only job is to hold a TXT record for a
        # minute at a time.
        $acme = Invoke-RestMethod -Method Post -UseBasicParsing `
            -Uri "$AcmeDnsServer/register"
        $acme | ConvertTo-Json | Set-Content $store -Encoding UTF8
        # The password renews the certificate for as long as this
        # deployment lives, and it is not recoverable.
        icacls $store /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)" | Out-Null
    }
    Write-Note "delegation target: $($acme.fulldomain)"

    Write-Step "Checking the delegation"
    $cname = "_acme-challenge.$Hostname"
    $points = $null
    try {
        $points = (Resolve-DnsName $cname -Type CNAME -ErrorAction Stop |
                   Where-Object { $_.NameHost }).NameHost
    } catch { }

    if ($points -ne $acme.fulldomain) {
        Write-Warn "The delegation is not in place yet."
        Write-Host @"

  Add this one record where $Hostname's DNS is managed, then run
  this script again. It is added once and never changes.

      Type   CNAME
      Name   _acme-challenge
      Value  $($acme.fulldomain)

  Some control panels want the name in full:

      _acme-challenge.$Hostname

  $(if ($points) { "Right now it points at '$points' instead." }
    else { "Right now there is no such record." })

  It can take a few minutes to propagate. Check with:

      Resolve-DnsName _acme-challenge.$Hostname -Type CNAME

"@ -ForegroundColor Yellow
        exit 1
    }
    Write-Note "$cname -> $points"
}

Write-Step "Downloading Caddy"
New-Item -ItemType Directory -Force -Path $CaddyDir | Out-Null
$exe = Join-Path $CaddyDir 'caddy.exe'
if (-not (Test-Path $exe)) {
    # The build service hands back the executable itself, not an
    # archive - `Content-Disposition: caddy_windows_amd64.exe`. Trying
    # to unzip it fails with "Split or spanned archives are not
    # supported", which reads as a corrupt download rather than as
    # there being nothing to unpack.
    # A DNS provider is a compiled-in module, not a plugin loaded at
    # runtime, so the build service assembles a binary that has it.
    $url = 'https://caddyserver.com/api/download?os=windows&arch=amd64'
    if ($AcmeDns) { $url += '&p=github.com/caddy-dns/acmedns' }
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $exe

    # A captive portal or a proxy answers with an HTML page and the
    # same 200, which would otherwise be saved as caddy.exe and fail
    # later as something unrecognisable. Every Windows executable
    # starts "MZ".
    $head = [System.IO.File]::ReadAllBytes($exe)[0..1]
    if (-join [char[]]$head -ne 'MZ') {
        Remove-Item $exe -Force
        throw ("What came back was not a Windows executable. Check whether " +
               "something on this network is intercepting the download, or fetch " +
               "caddy_windows_amd64.exe by hand from https://caddyserver.com/download " +
               "and save it as $exe")
    }
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

if ($AcmeDns) {
    # Nothing binds 80 - there is no redirect worth serving from a
    # port that cannot be reached - and the site answers on its own.
    $config = "{`r`n`tauto_https disable_redirects`r`n}`r`n`r`n" + $config
    $config = $config.Replace(
        "$Hostname {",
        ("{0}:{1} {{`r`n`ttls {{`r`n`t`tdns acmedns {{`r`n" +
         "`t`t`tusername   {2}`r`n`t`t`tpassword   {3}`r`n" +
         "`t`t`tsubdomain  {4}`r`n`t`t`tserver_url {5}`r`n" +
         "`t`t}}`r`n`t}}") -f $Hostname, $ListenPort,
            $acme.username, $acme.password, $acme.subdomain, $AcmeDnsServer)
} elseif ($ListenPort -ne 443) {
    $config = $config.Replace("$Hostname {", "${Hostname}:${ListenPort} {")
}

if ($NoPort80) {
    Write-Note "Port 80 left alone - certificate over TLS-ALPN-01 on 443."
    $config = "{`r`n`tauto_https disable_redirects`r`n}`r`n`r`n" + $config
    $config = $config.Replace(
        "$Hostname {",
        "$Hostname {`r`n`ttls {`r`n`t`tissuer acme {`r`n`t`t`tdisable_http_challenge`r`n`t`t}`r`n`t}")
}

$caddyfile = Join-Path $CaddyDir 'Caddyfile'
Set-Content -Path $caddyfile -Value $config -Encoding UTF8
Write-Note $caddyfile

& $exe validate --config $caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw "Caddy rejected the config." }

$open = if ($AcmeDns) { ,$ListenPort }
        elseif ($NoPort80) { ,443 }
        else { 80, 443 }
Write-Step "Opening $($open -join ' and ')"
foreach ($port in $open) {
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

$siteUrl = if ($ListenPort -eq 443) { "https://$Hostname" }
           else { "https://${Hostname}:${ListenPort}" }

Start-Sleep -Seconds 5
$state = (Get-Service Caddy).Status
if ($state -eq 'Running') {
    Write-Host "    Caddy: Running" -ForegroundColor Green
} else {
    Write-Warn "Caddy: $state - it started and stopped again."
    Write-Note "Almost always something already holding 80 or 443. Check:"
    Write-Note "    Get-Content $CaddyDir\caddy.err.log -Tail 40"
    Write-Note "    Get-NetTCPConnection -LocalPort 80,443 -State Listen |"
    Write-Note "      Select-Object LocalPort, OwningProcess"
    Write-Note "IIS is the usual culprit on Windows - 'Stop-Service W3SVC' frees it."
}

Write-Host @"

  Reachable at: $siteUrl

  Now, in $AppDir\.env.prod:

      ALLOWED_HOSTS=$Hostname
      CSRF_TRUSTED_ORIGINS=$siteUrl
      CORS_ALLOWED_ORIGINS=$siteUrl
      TRUST_PROXY_HEADER=True
      SECURE_SSL_REDIRECT=True

  Then rebuild, so the bundle calls the new origin, and bind the
  application server to loopback - Caddy is what the internet talks to:

      `$env:REACT_APP_API_URL = '$siteUrl/api/v1'
      .\deploy\windows\Start-Munch.ps1 -BindHost 127.0.0.1

  The first certificate takes up to a minute. Watch it:

      Get-Content $CaddyDir\caddy.err.log -Wait -Tail 30

"@ -ForegroundColor Gray
