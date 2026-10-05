<#
.SYNOPSIS
    Registers Munch's three processes as Windows services, using NSSM.

.DESCRIPTION
    Windows has no systemd, and these are three long-running
    foreground processes that must come back after a crash and start
    without anybody signed in. NSSM wraps each one as a real service
    so the Service Control Manager owns them.

    Run again after changing anything here - it removes and re-creates
    each service rather than editing in place, so the result does not
    depend on what was there before.

.PARAMETER AppDir
    Where the repository is checked out.

.PARAMETER Nssm
    Path to nssm.exe. Download from https://nssm.cc/download (the
    win64 build), or `choco install nssm`.

.PARAMETER WorkerThreads
    How many tasks the worker may run at once.

.EXAMPLE
    .\Install-MunchServices.ps1 -AppDir C:\munch -Nssm C:\tools\nssm.exe
#>
[CmdletBinding()]
param(
    [string] $AppDir        = 'C:\munch',
    [string] $Nssm          = 'nssm.exe',
    [int]    $Port          = 8000,
    [int]    $WorkerThreads = 4
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell." }

if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue)) {
    throw "nssm.exe not found. Download it from https://nssm.cc/download, or pass -Nssm C:\path\to\nssm.exe"
}

$python = Join-Path $AppDir 'venv\Scripts\python.exe'
$logs   = Join-Path $AppDir 'logs'
foreach ($p in @($python, (Join-Path $AppDir 'manage.py'), (Join-Path $AppDir '.env.prod'))) {
    if (-not (Test-Path $p)) { throw "Missing: $p" }
}
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# -m rather than the console scripts in Scripts\. Those are generated
# with the interpreter path baked in at install time, so they break
# the moment the checkout moves; `python -m` does not.
$services = @(
    @{
        Name = 'MunchWeb'
        Desc = 'Munch ASGI server (uvicorn) - HTTP and websockets'
        # Uvicorn, not Daphne: Twisted on Windows uses select(), which
        # stops at 512 sockets, and every attendee holds one open.
        # --proxy-headers so Django sees the scheme IIS received, which
        # is what stops SECURE_SSL_REDIRECT looping.
        Args = "-m uvicorn config.asgi:application " +
               "--host 127.0.0.1 --port $Port " +
               "--proxy-headers --forwarded-allow-ips 127.0.0.1"
        Log  = 'web'
    },
    @{
        Name = 'MunchWorker'
        Desc = 'Munch background worker (Celery)'
        # threads, not solo. Windows has no prefork pool, and solo runs
        # one task at a time - a single slow Drive sync then blocks
        # every reminder and every export behind it. These tasks wait
        # on networks and databases rather than on the CPU, and both
        # psycopg2 and the Django ORM are thread-safe, so a thread pool
        # is real concurrency here with nothing to monkey-patch.
        Args = "-m celery -A config.celery worker " +
               "--pool=threads --concurrency=$WorkerThreads --loglevel=INFO"
        Log  = 'worker'
    },
    @{
        Name = 'MunchBeat'
        Desc = 'Munch periodic scheduler (Celery beat)'
        # Exactly one of these, ever. Two do not share the schedule out
        # between them - each fires every entry, so everything runs twice.
        Args = "-m celery -A config.celery beat --loglevel=INFO"
        Log  = 'beat'
    }
)

foreach ($svc in $services) {
    Write-Step "$($svc.Name)"

    if (Get-Service -Name $svc.Name -ErrorAction SilentlyContinue) {
        & $Nssm stop   $svc.Name confirm 2>$null | Out-Null
        & $Nssm remove $svc.Name confirm 2>$null | Out-Null
        Start-Sleep -Milliseconds 500
    }

    & $Nssm install $svc.Name $python $svc.Args          | Out-Null
    & $Nssm set $svc.Name AppDirectory  $AppDir          | Out-Null
    & $Nssm set $svc.Name DisplayName   $svc.Name        | Out-Null
    & $Nssm set $svc.Name Description   $svc.Desc        | Out-Null
    & $Nssm set $svc.Name Start         SERVICE_AUTO_START | Out-Null

    # base.py reads .env.prod for everything else; these two decide
    # which settings module and which .env file, so they cannot
    # themselves come from it.
    & $Nssm set $svc.Name AppEnvironmentExtra `
        "DJANGO_ENV=prod" `
        "DJANGO_SETTINGS_MODULE=config.settings.production" `
        "PYTHONUNBUFFERED=1" | Out-Null

    # Without this the output goes nowhere and a service that will not
    # start gives you a Service Control Manager error code and nothing else.
    & $Nssm set $svc.Name AppStdout (Join-Path $logs "$($svc.Log).out.log") | Out-Null
    & $Nssm set $svc.Name AppStderr (Join-Path $logs "$($svc.Log).err.log") | Out-Null
    & $Nssm set $svc.Name AppRotateFiles  1        | Out-Null
    & $Nssm set $svc.Name AppRotateBytes  10485760 | Out-Null

    & $Nssm set $svc.Name AppExit Default Restart | Out-Null
    & $Nssm set $svc.Name AppRestartDelay 5000    | Out-Null
    # Long enough for open websockets to be closed rather than cut.
    & $Nssm set $svc.Name AppStopMethodConsole 30000 | Out-Null

    Write-Note "registered: python $($svc.Args)"
}

Write-Step "Starting"
# The web service last: the other two only need Redis, while anything
# hitting the site expects all three to be up.
foreach ($name in @('MunchWorker', 'MunchBeat', 'MunchWeb')) {
    & $Nssm start $name | Out-Null
    Start-Sleep -Seconds 2
    $state = (Get-Service -Name $name).Status
    $colour = if ($state -eq 'Running') { 'Green' } else { 'Red' }
    Write-Host ("    {0,-14} {1}" -f $name, $state) -ForegroundColor $colour
}

Write-Host @"

  Logs:     $logs
  Control:  Get-Service Munch* | Format-Table -AutoSize
            Restart-Service MunchWeb

  A service that will not stay running almost always says why in
  logs\<name>.err.log - look there before the Event Log.

"@ -ForegroundColor Gray
