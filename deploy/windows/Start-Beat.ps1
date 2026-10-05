<#
.SYNOPSIS
    Runs the Celery scheduler, with the environment it needs.

.DESCRIPTION
    The clock. It fires the reminders, and the sweep that lets go of
    attendees who have gone quiet - without it the register goes on
    saying people are in a room they left, which is wrong in the one
    place the event is a record of rather than a thing happening.

    Exactly one of these, ever. A second does not share the schedule
    out; both fire every entry, so everything runs twice.

    The schedule lives in the database, so beat keeps no state of its
    own and there is no file to place or lose.

.EXAMPLE
    .\Start-Beat.ps1
#>
[CmdletBinding()]
param(
    [string] $AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
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

Write-Host "`n==> Celery beat" -ForegroundColor Cyan
Write-Host "    Ctrl+C to stop.`n" -ForegroundColor DarkGray
& $py -m celery -A config.celery beat --loglevel=INFO
