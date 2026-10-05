<#
.SYNOPSIS
    Runs the Celery worker, with the environment it needs.

.DESCRIPTION
    Background work: processing recordings, syncing Drive, building
    exports and summaries. The site runs without it - only one user
    action dispatches a task - but anything queued simply waits.

    Exists so the two environment variables cannot be forgotten.
    Without DJANGO_ENV the settings look for .env.dev, fail to find
    it, fall back to .env, fail again, and the first setting that
    wanted a value reports SECRET_KEY missing - which is true and
    unhelpful.

    --pool=threads, not solo: Windows has no prefork pool, and solo
    runs one task at a time, so a slow Drive sync blocks every
    reminder behind it. These tasks wait on networks and databases
    rather than the CPU, and psycopg2 and the ORM are both
    thread-safe.

.EXAMPLE
    .\Start-Worker.ps1
#>
[CmdletBinding()]
param(
    [string] $AppDir  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [int]    $Threads = 4,
    [ValidateSet('standalone', 'production')]
    [string] $Settings = 'standalone'
)

$ErrorActionPreference = 'Stop'
Set-Location $AppDir

$py = Join-Path $AppDir 'venv\Scripts\python.exe'
if (-not (Test-Path $py))                 { throw "No virtualenv at $py." }
if (-not (Test-Path "$AppDir\.env.prod")) { throw "Missing $AppDir\.env.prod." }

$env:DJANGO_ENV             = 'prod'
$env:DJANGO_SETTINGS_MODULE = "config.settings.$Settings"
$env:PYTHONUNBUFFERED       = '1'

Write-Host "`n==> Celery worker, $Threads threads" -ForegroundColor Cyan
Write-Host "    Ctrl+C to stop.`n" -ForegroundColor DarkGray
& $py -m celery -A config.celery worker --pool=threads --concurrency=$Threads --loglevel=INFO
