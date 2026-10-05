<#
.SYNOPSIS
    Makes a Munch instance running inside WSL2 reachable, and keeps it
    running across reboots.

.DESCRIPTION
    Two things Windows has to do that the distro cannot do for itself:

    1. Start WSL at boot. A distro starts when something asks for it,
       and nothing asks on an unattended server - so the machine comes
       back from a restart with every service "enabled" and none of
       them running.

    2. Let traffic in. Under WSL2's default NAT the distro sits behind
       an address that changes on every boot, so ports 80 and 443 are
       forwarded to it and the forwarding is rebuilt each time. Under
       mirrored networking none of that is needed, and this script
       skips it.

.PARAMETER Distro
    The distro name as `wsl -l -q` prints it.

.PARAMETER Ports
    TCP ports to forward. Ignored under mirrored networking.

.EXAMPLE
    # From an elevated PowerShell:
    .\Setup-MunchHost.ps1 -Distro Ubuntu

.EXAMPLE
    # Re-apply the forwarding after a reboot, without touching the task.
    .\Setup-MunchHost.ps1 -Distro Ubuntu -RefreshOnly
#>
[CmdletBinding()]
param(
    [string]   $Distro      = 'Ubuntu',
    [int[]]    $Ports       = @(80, 443),
    [switch]   $RefreshOnly,

    # Who the startup task runs as. Defaults to whoever is running
    # this, which is the account that must also own the distro - see
    # the note where the task is registered.
    [string]   $TaskUser    = "$env:USERDOMAIN\$env:USERNAME",

    # Register the task under SYSTEM instead. Only correct if the
    # distro was installed by SYSTEM too, which is unusual.
    [switch]   $AsSystem
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Note { param($m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }

# -- Checks ------------------------------------------------------------

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    throw "Run this from an elevated PowerShell (Run as Administrator)."
}

if (-not (wsl.exe -l -q | Where-Object { $_.Trim() -eq $Distro })) {
    throw "No WSL distro named '$Distro'. Installed: $((wsl.exe -l -q) -join ', ')"
}

Write-Step "Starting $Distro"
# Boots the distro if it is not already up, which is also what starts
# systemd and with it every enabled Munch unit.
wsl.exe -d $Distro --exec /bin/true
if ($LASTEXITCODE -ne 0) { throw "Could not start $Distro." }

Write-Step "Checking systemd"
$systemd = (wsl.exe -d $Distro --exec sh -c 'pidof systemd >/dev/null 2>&1 && echo yes || echo no').Trim()
if ($systemd -ne 'yes') {
    Write-Warn "systemd is not running in $Distro."
    Write-Note "Put deploy/wsl2/wsl.conf at /etc/wsl.conf inside the distro,"
    Write-Note "then run 'wsl --shutdown' and start it again."
}

# -- Networking mode ---------------------------------------------------

Write-Step "Networking mode"
# Mirrored mode gives the distro the host's own addresses, so there is
# nothing to forward. The reliable test is whether WSL still has a
# private NAT address of its own.
$wslIp = (wsl.exe -d $Distro --exec sh -c "hostname -I | awk '{print `$1}'").Trim()
$hostIps = (Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress
$mirrored = $hostIps -contains $wslIp

if ($mirrored) {
    Write-Note "Mirrored - the distro answers on the host's own addresses ($wslIp)."
    Write-Note "No port forwarding needed."
} else {
    Write-Note "NAT - the distro is at $wslIp, behind the host."

    Write-Step "Forwarding $($Ports -join ', ')"
    foreach ($port in $Ports) {
        # Removed first: the stored address is last boot's and no
        # longer routes anywhere.
        netsh interface portproxy delete v4tov4 `
            listenport=$port listenaddress=0.0.0.0 2>$null | Out-Null
        netsh interface portproxy add v4tov4 `
            listenport=$port listenaddress=0.0.0.0 `
            connectport=$port connectaddress=$wslIp | Out-Null
        Write-Note "0.0.0.0:$port -> ${wslIp}:$port"
    }

    $ruleName = 'Munch (WSL2)'
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName `
            -Direction Inbound -Action Allow -Protocol TCP `
            -LocalPort $Ports | Out-Null
        Write-Note "Firewall rule '$ruleName' added for $($Ports -join ', ')."
    }
}

if ($RefreshOnly) {
    Write-Step "Done (forwarding only)."
    return
}

# -- Start at boot -----------------------------------------------------

Write-Step "Registering the boot task"

# WSL distros are registered per Windows user profile, not per
# machine. A distro installed while signed in as Administrator does
# not exist for SYSTEM, so a startup task running as SYSTEM finds no
# distribution and the server comes back from a reboot with nothing
# listening - and nothing in the log to say why, because the task
# itself ran fine.
#
# So the task runs as the account that owns the distro, which is
# whoever is running this script. S4U lets it start without a stored
# password; it gets no network credentials, which is fine because
# everything it does is local.
$taskName = 'Munch - start WSL and publish ports'
$script   = $MyInvocation.MyCommand.Path

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden " +
               "-ExecutionPolicy Bypass -File `"$script`" " +
               "-Distro $Distro -Ports $($Ports -join ',') -RefreshOnly")

$trigger = New-ScheduledTaskTrigger -AtStartup
# WSL and the network are not ready the instant the service manager
# starts; without this the task runs, finds nothing, and the box comes
# up unreachable.
$trigger.Delay = 'PT45S'

if ($AsSystem) {
    $principal = New-ScheduledTaskPrincipal `
        -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Write-Warn "Task will run as SYSTEM. It will only work if the distro was registered by SYSTEM."
} else {
    $principal = New-ScheduledTaskPrincipal `
        -UserId $TaskUser -LogonType S4U -RunLevel Highest
    Write-Note "Task will run as $TaskUser - the account this distro belongs to."
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Force `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    | Out-Null

Write-Note "Task '$taskName' registered (at startup, 45s delay)."
Write-Warn "Not proven until the machine has actually been restarted."
Write-Note "Reboot, do not sign in, and check the site answers from another machine."

# -- Done --------------------------------------------------------------

Write-Step "Checking"
try {
    $response = Invoke-WebRequest -Uri 'http://localhost/' -UseBasicParsing -TimeoutSec 10
    Write-Host "    http://localhost/ -> $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Warn "http://localhost/ did not answer: $($_.Exception.Message)"
    Write-Note "Inside the distro, check:  sudo systemctl status munch-daphne nginx"
}

Write-Host @"

  Done.

  Useful afterwards:

    wsl -d $Distro -- sudo systemctl status munch-daphne munch-worker munch-beat
    wsl -d $Distro -- sudo journalctl -u munch-daphne -f
    netsh interface portproxy show v4tov4

"@ -ForegroundColor Gray
