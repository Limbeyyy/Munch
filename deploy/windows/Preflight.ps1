<#
.SYNOPSIS
    Checks the things that are not this application, before starting it.

.DESCRIPTION
    Celery does not fail usefully when Redis is absent. It starts, tries
    to schedule, retries twenty times, prints several hundred lines of
    traceback, announces that the application must be restarted, and
    then does the whole thing again a minute later. Nowhere in that does
    it say the one useful sentence, which is that nothing is listening
    on 6379.

    So it is said here, before anything starts.
#>

<#
.SYNOPSIS
    One value out of a .env file.

.DESCRIPTION
    Inline comments are part of the value as far as django-environ is
    concerned, and a `LOG_LEVEL=INFO   # chatty` once killed every
    management command on this project. They are stripped here so the
    preflight reads what the application will read, not something
    tidier.
#>
function Get-EnvValue {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Name,
        [string] $Default = ''
    )

    if (-not (Test-Path $Path)) { return $Default }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $at = $trimmed.IndexOf('=')
        if ($at -lt 1) { continue }
        if ($trimmed.Substring(0, $at).Trim() -ne $Name) { continue }

        $value = $trimmed.Substring($at + 1).Trim()
        $value = ($value -replace '\s+#.*$', '').Trim()
        return $value.Trim('"').Trim("'")
    }
    return $Default
}

<# Whether anything is listening there at all. #>
function Test-TcpPort {
    param(
        [Parameter(Mandatory)] [string] $ComputerName,
        [Parameter(Mandatory)] [int] $Port,
        [int] $TimeoutMs = 2000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $waiting = $client.BeginConnect($ComputerName, $Port, $null, $null)
        if (-not $waiting.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($waiting)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

<#
.SYNOPSIS
    Refuse to start without Redis, and say so in one line.
#>
function Assert-RedisUp {
    param(
        [Parameter(Mandatory)] [string] $AppDir,
        [string] $EnvFile = '.env.prod'
    )

    $path = Join-Path $AppDir $EnvFile
    $redisHost = Get-EnvValue -Path $path -Name 'REDIS_HOST' -Default 'localhost'
    $redisPort = [int](Get-EnvValue -Path $path -Name 'REDIS_PORT' -Default '6379')

    if (Test-TcpPort -ComputerName $redisHost -Port $redisPort) {
        Write-Host "    Redis: $redisHost`:$redisPort is up." -ForegroundColor DarkGray
        return
    }

    throw @"
Redis is not answering on ${redisHost}:${redisPort}.

Nothing will work without it: Celery queues through it, beat schedules
through it, and the websockets that carry a live room share it too.

There is no official Redis for Windows. This deployment uses Memurai,
which installs as a service:

    Get-Service Memurai              # is it installed?
    Start-Service Memurai            # start it
    Set-Service Memurai -StartupType Automatic   # and keep it started
    redis-cli ping                   # expect: PONG

If Redis lives on another machine, point REDIS_HOST and REDIS_PORT in
$path at it - and REDIS_URL, REDIS_CACHE_URL and REDIS_WS_URL with it,
because those carry their own host and are what Django actually reads.
"@
}
