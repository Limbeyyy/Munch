<#
.SYNOPSIS
    Pull, build and run Munch as a single Python process.

.DESCRIPTION
    The whole application in one command: Django serves the frontend,
    its own static files and the uploads, and uvicorn serves Django.
    No IIS, no nginx, no WSL2.

    Right for an event on a local network, or one application on one
    server. Not a reason to remove a proxy from a deployment that
    already has one working - see README.md for what this trades away.

.PARAMETER AppDir
    Where the repository is checked out.

.PARAMETER Port
    What to listen on. 8000 by default; 80 needs an elevated shell.

.PARAMETER Pull
    git pull, and reinstall dependencies, before starting.

.PARAMETER SkipBuild
    Leave the existing frontend bundle alone. Much faster, and correct
    whenever only Python has changed.

.EXAMPLE
    .\Start-Munch.ps1 -Pull

.EXAMPLE
    # Day to day, after no frontend change:
    .\Start-Munch.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    # Worked out from where this script is, rather than guessed. The
    # checkout is not always at C:\munch, and a wrong default here
    # fails later and somewhere else - as a missing .env.prod, or a
    # venv that is not there.
    [string] $AppDir    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [int]    $Port      = 8000,
    [string] $BindHost  = '0.0.0.0',
    [switch] $Pull,
    [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }

# -- Running other programs ------------------------------------------
#
# $ErrorActionPreference = 'Stop' turns anything a native command
# writes to stderr into a terminating error as soon as 2>&1 captures
# it. Plenty of healthy programs write to stderr: a successful
# `import drf_yasg` emits a setuptools deprecation warning, and that
# alone was enough to report every dependency as missing.
#
# So the stream is captured with that off, and the verdict comes from
# the exit code, which is what it is for.
function Invoke-Native {
    param([scriptblock] $Command)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Command 2>&1 | Out-String
        return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Output = $output.Trim() }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }

Set-Location $AppDir

$py = Join-Path $AppDir 'venv\Scripts\python.exe'
if (-not (Test-Path $py))                     { throw "No virtualenv at $py. Run: python -m venv venv" }
if (-not (Test-Path "$AppDir\.env.prod"))     { throw "Missing $AppDir\.env.prod. Copy deploy\windows\env.prod.example and fill it in." }

# These two decide which settings module and which .env file, so they
# cannot themselves come from the .env file.
$env:DJANGO_ENV             = 'prod'
$env:DJANGO_SETTINGS_MODULE = 'config.settings.standalone'
$env:PYTHONUNBUFFERED       = '1'

if ($Pull) {
    Write-Step "Pulling"
    git pull
    Write-Step "Dependencies"
    & $py -m pip install --quiet --upgrade pip
    & $py -m pip install --quiet -r requirements.txt -r deploy\windows\requirements-windows.txt
}

# -- Is everything installed? ----------------------------------------
#
# Django imports INSTALLED_APPS before it does anything else, so a
# missing package surfaces as a ModuleNotFoundError forty frames deep
# in app registry setup - during `migrate`, which makes it look like
# a database problem. Asking directly costs a second and says what is
# actually wrong.
Write-Step "Dependencies"
$probe = Invoke-Native {
    & $py -c "import daphne, channels, uvicorn, whitenoise, psycopg2, celery, rest_framework, allauth, drf_yasg, django_celery_beat, corsheaders, cryptography; print('ok')"
}
if (-not $probe.Ok) {
    Write-Host "    $($probe.Output)" -ForegroundColor Red
    throw ("A package is missing, so Django cannot load its apps. Install them:`n" +
           "     .\venv\Scripts\pip install -r requirements.txt -r deploy\windows\requirements-windows.txt`n" +
           "   Then run this again.")
}
Write-Note "all present"

Write-Step "Migrations"
& $py manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw "Migrations failed." }

if (-not $SkipBuild) {
    Write-Step "Frontend"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm not found. Install Node 18 or newer." }

    # Deliberately left unset, which is what makes this work from any
    # address. Unset, the app derives its API from whatever host the
    # browser used - `<protocol>//<hostname>:8000/api/v1` - so the
    # same bundle is correct by IP, by hostname, and from every
    # machine on the network.
    #
    # It cannot be a relative path: the websocket code does
    # `new URL(API_BASE_URL)` to find the host, and `new URL('/api/v1')`
    # throws, which would take out the live room, the transcript and
    # the guest hub while leaving the rest of the site working.
    #
    # The fallback has port 8000 written into it. That is why this
    # listens on 8000 by default, and why serving on 80 means setting
    # REACT_APP_API_URL to a full absolute URL and pinning the
    # hostname into the bundle.
    if ($env:REACT_APP_API_URL) {
        Write-Note "REACT_APP_API_URL=$($env:REACT_APP_API_URL) (pinned)"
    } elseif ($Port -ne 8000) {
        throw ("Serving on port $Port needs REACT_APP_API_URL set to an absolute URL, " +
               "e.g. http://<this machine>:$Port/api/v1 - the bundle's own fallback assumes 8000.")
    } else {
        Write-Note "REACT_APP_API_URL unset - the bundle will follow whatever address it is opened from."
    }

    Push-Location (Join-Path $AppDir 'Munch-frontend')
    try {
        if (Test-Path 'package-lock.json') { npm ci --no-audit --no-fund } else { npm install }
        # CI=true makes eslint warnings fatal, which is what stops a
        # broken bundle shipping.
        $env:CI = 'true'
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "The frontend build failed." }
    } finally { Pop-Location }
}

Write-Step "Static files"
& $py manage.py collectstatic --noinput --clear | Select-Object -Last 1

# -- Let it in through the firewall ----------------------------------
#
# Serving on 0.0.0.0 and being reachable are different things, and
# the gap between them looks exactly like the application being
# broken: it answers on the machine itself and from nowhere else.
if ($BindHost -ne '127.0.0.1') {
    $admin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $rule = "Munch TCP $Port"
    if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
        Write-Note "firewall: '$rule' already allowed"
    } elseif ($admin) {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound `
            -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
        Write-Note "firewall: opened $Port"
    } else {
        Write-Note "firewall: port $Port is not open, and this shell is not elevated."
        Write-Note "  From an admin shell, once:"
        Write-Note "  New-NetFirewallRule -DisplayName '$rule' -Direction Inbound ``"
        Write-Note "    -Action Allow -Protocol TCP -LocalPort $Port"
    }
}

Write-Step "Starting on http://${BindHost}:${Port}"
Write-Note "Reachable from other machines on this network at http://<this machine's ip>:$Port"
Write-Note "Ctrl+C to stop."
Write-Host ""

# --proxy-headers is deliberately absent. There is nothing in front of
# this, so there is no proxy whose X-Forwarded-Proto could be trusted -
# honouring it here would mean honouring whatever a client sent.
& $py -m uvicorn config.asgi:application --host $BindHost --port $Port
