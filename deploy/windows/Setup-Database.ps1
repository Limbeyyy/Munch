<#
.SYNOPSIS
    Creates the PostgreSQL role and database Munch needs, and proves
    they work.

.DESCRIPTION
    Finds psql.exe wherever the installer put it, creates the role and
    the database with the right ownership, applies init.sql, and then
    checks the one thing that actually matters: whether the
    application's role can create tables.

    Safe to run again. Everything it does is conditional on not having
    been done.

.PARAMETER Password
    The application role's password. Taken from .env.prod when it is
    already set there, which keeps the two from disagreeing.

.EXAMPLE
    .\Setup-Database.ps1
#>
[CmdletBinding()]
param(
    [string] $AppDir   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string] $DbName   = 'munch_db',
    [string] $DbUser   = 'munch',
    [string] $Password,
    [string] $Psql
)

$ErrorActionPreference = 'Stop'
function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }

# -- Find psql -------------------------------------------------------
#
# The version is in the path, so hard-coding 16 breaks on 15 and on
# 17, and the error - "is not recognized as the name of a cmdlet" -
# says nothing about which part of the path was wrong.
Write-Step "Looking for psql"
if (-not $Psql) {
    $onPath = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($onPath) { $Psql = $onPath.Source }
}
if (-not $Psql) {
    $Psql = Get-ChildItem -Path 'C:\Program Files\PostgreSQL',
                                'C:\Program Files (x86)\PostgreSQL' `
                          -Filter psql.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Psql) {
    $svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue
    throw (
        "psql.exe not found." + $(if ($svc) {
            " A PostgreSQL service ($($svc.Name)) exists, so it is installed somewhere this did not look - pass -Psql C:\path\to\psql.exe"
        } else {
            " PostgreSQL does not appear to be installed. Get it from https://www.postgresql.org/download/windows/"
        })
    )
}
Write-Note $Psql

# -- The password ----------------------------------------------------
$envFile = Join-Path $AppDir '.env.prod'
if (-not $Password -and (Test-Path $envFile)) {
    $line = Select-String -Path $envFile -Pattern '^DB_PASSWORD=(.*)$' |
            Select-Object -First 1
    if ($line) { $Password = $line.Matches[0].Groups[1].Value.Trim() }
    if ($Password) { Write-Note "password taken from .env.prod" }
}
if (-not $Password) {
    throw "No password. Set DB_PASSWORD in $envFile, or pass -Password."
}

Write-Host "`n    You will be asked for the *postgres* superuser password" -ForegroundColor DarkGray
Write-Host "    - the one set when PostgreSQL was installed, not the above.`n" -ForegroundColor DarkGray

function Invoke-Psql {
    param([string]$Sql, [string]$Database = 'postgres')
    # Same reasoning as Invoke-Native in Start-Munch.ps1: psql writes
    # notices to stderr while succeeding, and with $ErrorActionPreference
    # at Stop, capturing one would end the script.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Psql -U postgres -d $Database -tAc $Sql 2>&1 | Out-String
        $failed = ($LASTEXITCODE -ne 0)
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($failed) { throw "psql failed: $($out.Trim())" }
    return $out.Trim()
}

Write-Step "Role '$DbUser'"
if ((Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'") -eq '1') {
    Invoke-Psql "ALTER ROLE $DbUser WITH LOGIN PASSWORD '$Password'" | Out-Null
    Write-Note "existed; password set to match .env.prod"
} else {
    Invoke-Psql "CREATE ROLE $DbUser LOGIN PASSWORD '$Password'" | Out-Null
    Write-Note "created"
}
# So the test suite can make and drop its own scratch database.
# Nothing the application itself does needs this.
Invoke-Psql "ALTER ROLE $DbUser CREATEDB" | Out-Null

Write-Step "Database '$DbName'"
if ((Invoke-Psql "SELECT 1 FROM pg_database WHERE datname='$DbName'") -eq '1') {
    Write-Note "already there"
} else {
    # OWNER is the whole point. From PostgreSQL 15 a role that does
    # not own the database cannot create tables in its public schema,
    # and the failure arrives later, at migrate, as "permission denied
    # for schema public" - which reads as a login problem.
    Invoke-Psql "CREATE DATABASE $DbName OWNER $DbUser" | Out-Null
    Write-Note "created, owned by $DbUser"
}

Write-Step "Grants"
# init.sql, applied to the right database. A grant on the public
# schema belongs to one database, so running this against the default
# postgres database succeeds and achieves nothing.
$init = Join-Path $AppDir 'init.sql'
if (Test-Path $init) {
    & $Psql -U postgres -d $DbName -f $init | Out-Null
    Write-Note "applied init.sql to $DbName"
} else {
    Invoke-Psql "GRANT ALL ON SCHEMA public TO $DbUser" $DbName | Out-Null
    Write-Note "granted directly ($init not found)"
}

# -- The only check that settles it ----------------------------------
Write-Step "Checking as $DbUser"
$env:PGPASSWORD = $Password
try {
    $can = (& $Psql -U $DbUser -d $DbName -h localhost -tAc `
        "SELECT has_schema_privilege(current_user,'public','CREATE')" 2>&1 |
        Out-String).Trim()
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ($can -eq 't') {
    Write-Host "    $DbUser can create tables in $DbName. Ready to migrate." -ForegroundColor Green
    Write-Host "`n    .\deploy\windows\Start-Munch.ps1 -BindHost 127.0.0.1`n" -ForegroundColor Gray
} else {
    Write-Warn "Connected, but $DbUser cannot create in the public schema."
    Write-Note "psql said: $can"
    Write-Note "If it refused the connection, DB_PASSWORD in .env.prod does not match."
    exit 1
}
