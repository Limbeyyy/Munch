# The simple way: one Python process, no proxy

Written for: whoever wants Munch running on a Windows machine today,
without IIS, nginx or WSL2.

Django serves the frontend, its own static files and the uploads;
uvicorn serves Django. One command, one port, one thing to restart.

Right for an event on a local network, or one application on one
server. [`README.md`](README.md) is the fuller Windows deployment with
IIS in front — use that when you need TLS on 443, a hostname, or
someone else's site on the same box.

```
browser ──▶ :8000 uvicorn ──▶ Django ──▶ the frontend, /django-static/, /media/
                                │                    PostgreSQL
                       celery ──┤ worker + beat      Memurai (Redis)

and once it needs TLS and a public name:

browser ──▶ :443 Caddy ──▶ 127.0.0.1:8000 uvicorn ──▶ Django
            (certificate, renewal,
             /django-static/ and /media/ off disk)
```

---

## Use PowerShell, not Command Prompt

Every script here is PowerShell. In `cmd.exe` they do not run and the
errors do not say why:

| What you typed | cmd says | What it means |
|---|---|---|
| `.\deploy\...\Install-Caddy.ps1` | `The system cannot find the file specified.` | cmd cannot execute a `.ps1` |
| `$env:REACT_APP_API_URL = '...'` | `The filename, directory name, or volume label syntax is incorrect.` | `$env:` is PowerShell syntax; cmd uses `set` |

Open **Windows PowerShell as Administrator**. You can tell them apart
by the prompt: PowerShell starts with `PS`, Command Prompt does not.

If a script is refused with *"running scripts is disabled on this
system"*, allow signed and local scripts for your account, once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## What you need

| | Where | Note |
|---|---|---|
| Python 3.12 | python.org | tick **Add python.exe to PATH** |
| Node 20 LTS | nodejs.org | only to build the frontend |
| PostgreSQL 16 | postgresql.org | |
| Memurai | memurai.com | Redis for Windows; Developer edition is free |

No IIS, no ARR, no URL Rewrite, no NSSM.

## First time

The checkout can live anywhere - the scripts work out where they are
rather than assuming `C:\munch`. These examples use `C:\projects\Munch`.

```powershell
git clone <your remote> C:\projects\Munch
cd C:\projects\Munch
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt -r deploy\windows\requirements-windows.txt
```

The database:

```powershell
.\deploy\windows\Setup-Database.ps1
```

It finds `psql.exe` wherever the installer put it - the version is in
the path, so `...\PostgreSQL\16\bin\` is wrong on 15 and on 17 -
takes the password from `.env.prod` so the two cannot disagree,
creates the role and the database with the right ownership, applies
`init.sql`, and ends by checking that the application's role can
actually create tables. Safe to run again.

It asks for the **postgres** superuser password, which is the one set
when PostgreSQL was installed, not `DB_PASSWORD`.

<details>
<summary>By hand, if you would rather</summary>

```powershell
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

& $psql -U postgres -c "CREATE USER munch WITH PASSWORD 'pick-something';"
& $psql -U postgres -c "CREATE DATABASE munch_db OWNER munch;"

# Lets the test suite create and drop its own scratch database.
# Nothing the application does needs it.
& $psql -U postgres -c "ALTER ROLE munch CREATEDB;"
```

`OWNER munch` is the part that matters. On PostgreSQL 15 and later a
role that does not own the database cannot create tables in the
`public` schema, and `migrate` stops with *permission denied for
schema public* - which reads as a login problem rather than an
ownership one.

`init.sql` in the repository root grants exactly those rights. It is
there for the Docker path, where it runs automatically, and is
redundant when the database was created with an owner. Run it if the
check below fails - and note `-d munch_db`, because a grant on the
`public` schema applies to one database and silently does nothing
useful against another:

```powershell
& $psql -U postgres -d munch_db -f .\init.sql
```

**Check** - this has to print `t`:

```powershell
& $psql -U munch -d munch_db -h localhost `
    -c "SELECT has_schema_privilege(current_user,'public','CREATE');"
```

`f` means the grant did not apply. Refusing to connect at all means
the password does not match `DB_PASSWORD` in `.env.prod`.

</details>

The environment:

Note the destination: the **repository root**, beside `manage.py`.
Django looks for it there and nowhere else, so a copy left in
`deploy\windows\` is not read and the failure is a missing
`SECRET_KEY` rather than a missing file.

```powershell
copy deploy\windows\env.prod.example .\.env.prod
notepad .\.env.prod
```

Set `DB_PASSWORD`, and these three — which here are **the machine's own
address**, not a domain:

```
ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.50
CSRF_TRUSTED_ORIGINS=http://192.168.1.50:8000
CORS_ALLOWED_ORIGINS=http://192.168.1.50:8000
```

Generate the secrets:

```powershell
.\venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(50))"
.\venv\Scripts\python -c "import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

Fix the one eslint warning that stops the build — `CI=true` makes
warnings fatal, which is what keeps a broken bundle from shipping. In
`Munch-frontend\src\attendee\pwa\BoardScreen.tsx` line 201:

```diff
-  const { t, num } = useOrganizer();
+  const { t } = useOrganizer();
```

Then:

```powershell
.\deploy\windows\Start-Munch.ps1
```

That migrates, builds the frontend, collects the static files and
starts serving. First run takes a few minutes for `npm ci`.

An administrator, in a second window:

```powershell
cd C:\munch
$env:DJANGO_ENV='prod'; $env:DJANGO_SETTINGS_MODULE='config.settings.standalone'
.\venv\Scripts\python manage.py createsuperuser
```

Let it through the firewall, once:

```powershell
New-NetFirewallRule -DisplayName "Munch" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000
```

Open `http://<this machine's ip>:8000/` from a phone on the same
network.

## Every time after

```powershell
.\deploy\windows\Start-Munch.ps1 -Pull              # pull, reinstall, rebuild, run
.\deploy\windows\Start-Munch.ps1 -SkipBuild         # Python-only change; much faster
```

## Background work

Reminders, Drive sync and exports need two more processes. Nothing
breaks without them — the site works and the queue simply fills — so
start here and add them when you need them. Two more windows:

```powershell
cd C:\munch
$env:DJANGO_ENV='prod'; $env:DJANGO_SETTINGS_MODULE='config.settings.standalone'

.\venv\Scripts\python -m celery -A config.celery worker --pool=threads --concurrency=4 --loglevel=INFO
.\venv\Scripts\python -m celery -A config.celery beat --loglevel=INFO
```

`--pool=threads`, not `--pool=solo`: Windows has no prefork pool, and
solo runs one task at a time, so a slow Drive sync blocks every
reminder behind it. These tasks wait on networks and databases rather
than the CPU, and psycopg2 and the ORM are both thread-safe.

Once it is working, make all three survive a reboot with NSSM —
[`services\Install-MunchServices.ps1`](services/Install-MunchServices.ps1)
does it, and `-AppDir C:\munch` is the only argument it usually needs.
Edit the `DJANGO_SETTINGS_MODULE` it sets to `config.settings.standalone`
first, since it is written for the IIS deployment.

---

## Why port 8000, and not 80

The frontend bundle has its API address baked in at build time. Left
unset — which is what `Start-Munch.ps1` does — the app works it out
from whatever address the browser used:
`<protocol>//<hostname>:8000/api/v1`. That is why the same build is
correct by IP, by hostname, and from every machine on the network
without rebuilding.

The **8000 in that fallback is fixed**. To serve on 80, set
`REACT_APP_API_URL` to a full absolute URL before building —
`http://192.168.1.50/api/v1` — which pins that address into the bundle
and means rebuilding if it changes.

It cannot be a relative path like `/api/v1`. The websocket code calls
`new URL(API_BASE_URL)` to find the host, and that throws on a
relative URL — which would take out the live room, the transcript and
the guest hub while leaving the rest of the site apparently fine.

## Putting it on the internet, over plain HTTP

The quickest way to have it reachable, and a reasonable first step
even if TLS is coming later: one process, one port, no proxy and no
certificate.

Pick a port your network already forwards - the same way whatever is
on `:8081` got there.

```powershell
# If Caddy was set up earlier, take it out of the way first.
Stop-Service Caddy -ErrorAction SilentlyContinue
Set-Service Caddy -StartupType Disabled -ErrorAction SilentlyContinue
```

In `.env.prod` - note `http`, the port on the origins, and both TLS
switches off:

```
ALLOWED_HOSTS=gpsnepal.com.np,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=http://gpsnepal.com.np:8090
CORS_ALLOWED_ORIGINS=http://gpsnepal.com.np:8090
TRUST_PROXY_HEADER=False
SECURE_SSL_REDIRECT=False
```

`TRUST_PROXY_HEADER=False` matters: with nothing in front, any client
could send `X-Forwarded-Proto: https` and be believed.

Then build and run. `REACT_APP_API_URL` is **required** on any port
but 8000 - the fallback baked into the bundle assumes that port, and
without this the site loads and nothing in it works:

```powershell
$env:REACT_APP_API_URL = 'http://gpsnepal.com.np:8090/api/v1'
.\deploy\windows\Start-Munch.ps1 -Port 8090
```

Leave `-BindHost` alone. It defaults to `0.0.0.0`, which is what
makes it answer to anything other than the machine itself.

Last, forward **8090** to this machine on the router, as `:8081`
already is.

**Check:** `http://gpsnepal.com.np:8090/` from a phone on mobile
data. On the LAN it will work whether or not the forward exists, so
that test proves nothing.

### What plain HTTP costs

Nothing refuses to run, and nothing crashes - both features below are
guarded. But browsers withhold three things from a page that is not
on a secure origin:

- **No installing it to a home screen**, and no offline shell - a
  service worker is refused outright over plain HTTP
- **No desktop notifications** for the host's reminders
- **Traffic is readable in transit**, including the sign-in. On a
  conference network that is a real consideration, not a formality.

Everything else is unaffected. The API, the live room, the
transcript, the question hub and file uploads all work - websockets
run over `ws://` quite happily.

## Putting it on the internet, with TLS

Add Caddy in front. It gets a certificate from Let's Encrypt on first
start and renews it by itself, proxies websockets without being asked
to, and sets `X-Forwarded-Proto` as a matter of course - which is the
header everything below depends on.

It is one `.exe` and about forty lines of config. IIS does the same
job and is already written up in [`README.md`](README.md), but it
needs ARR, the URL Rewrite module, the WebSocket feature, and two
machine-wide settings that fail silently when missed. For this, Caddy
is less to get wrong.

**It has to be a domain name, not an IP address.** A public CA issues
a certificate for a name it can verify you control, and it cannot do
that for `192.168.1.50` - that address is not yours, it is everybody's,
and nothing on the internet can reach it to run the challenge. No
configuration works around this. You need something like
`munch.yourorg.com.np` that resolves publicly to this server.

No domain? A free dynamic-DNS name from DuckDNS or No-IP works with
Let's Encrypt and takes a few minutes.

Two more things have to be true, and neither is arranged on this
machine:

- the name resolves to your public address
- **ports 80 and 443 reach the machine from the internet** - usually a
  port-forward on the router. Port 80 is not optional: it answers the
  challenge, now and at every renewal, and plenty of ISPs block it
  inbound.

If your connection is behind CGNAT, port forwarding cannot work at
all: compare the WAN address in the router against what the internet
reports as your IP, and if they differ - or the router's WAN address
starts `100.64.` to `100.127.` - you are sharing a public address with
other customers. A tunnel (Cloudflare Tunnel and similar) is then the
only way in, and it terminates TLS itself, so Caddy is not what you
want.

### LAN only?

Then you need none of this. Caddy will issue its own certificate with
`tls internal`, but every browser warns until its local CA is
installed on each device - fine for a few staff laptops, not for a
room full of attendees' phones. On a closed network, plain HTTP on
port 8000 is the better trade.

Then, from the repository in an elevated PowerShell:

```powershell
.\deploy\windows\caddy\Install-Caddy.ps1 -Hostname munch.example.np -Nssm C:\tools\nssm.exe
```

That downloads Caddy, writes the site config from
[`caddy/Caddyfile`](caddy/Caddyfile), registers it as a service, opens
80 and 443, and **removes any rule publishing 8000** - nothing outside
should reach the application server directly, since it speaks plain
HTTP and would answer to whatever `Host` it was given.

Now tell Django it is behind something. In `C:\munch\.env.prod`:

```
ALLOWED_HOSTS=munch.example.np
CSRF_TRUSTED_ORIGINS=https://munch.example.np
CORS_ALLOWED_ORIGINS=https://munch.example.np
TRUST_PROXY_HEADER=True
SECURE_SSL_REDIRECT=True
```

`TRUST_PROXY_HEADER` is the important one, and it is off by default
for a reason. `X-Forwarded-Proto` is a header like any other: with
nothing in front to overwrite it, any client could send
`X-Forwarded-Proto: https` on a plain HTTP request and be believed.
With Caddy in front it is the opposite - the header is the only way
Django can know, because Caddy terminates TLS and speaks plain HTTP
to uvicorn. Turn it on **only** once a proxy is genuinely there.

Rebuild so the bundle calls the new origin, and bind the application
server to loopback:

```powershell
$env:REACT_APP_API_URL = 'https://munch.example.np/api/v1'
.\deploy\windows\Start-Munch.ps1 -BindHost 127.0.0.1
```

The absolute URL matters here. The fallback that made this work by IP
assumes port 8000, which is now behind the proxy and not what a
browser talks to.

The first certificate takes up to a minute:

```powershell
Get-Content C:\caddy\caddy.err.log -Wait -Tail 30
```

**Check:** `https://munch.example.np/` loads with a valid certificate;
`http://munch.example.np/` redirects to it; the live room connects.

### When 80 and 443 cannot be reached at all

An ISP that blocks inbound 80 and 443 - ordinary on a business line -
leaves no port for Let's Encrypt to validate on. **Serving on 8090
does not help**: ACME validates on 80 or 443 and nowhere else, and
that is fixed by the specification, not by Caddy.

What is left is DNS-01, which proves the name by a TXT record and
needs no inbound connection at all. The record has to be written
automatically at each renewal, though, and most DNS hosts have no API
for it - so the one record ACME looks at is delegated, once and by
hand, to a service that does. Nothing else about your DNS moves.

```powershell
.\deploy\windows\caddy\Install-Caddy.ps1 `
    -Hostname munch.example.np -AcmeDns -ListenPort 8090
```

The first run registers an anonymous acme-dns account, saves it to
`C:\caddy\acmedns.json`, prints one CNAME record and stops:

```
Type   CNAME
Name   _acme-challenge
Value  <something>.auth.acme-dns.io
```

Add that where your DNS is managed, wait for it to propagate, and run
the same command again. It checks the delegation, fetches a Caddy
build with the acme-dns module compiled in, and gets the certificate
over DNS-01. Renewals then need nothing from you - the delegation is
permanent.

**Keep `C:\caddy\acmedns.json`.** It renews the certificate for as
long as this deployment lives and cannot be recovered; losing it means
registering again and changing the CNAME.

The site is then at `https://munch.example.np:8090`. A certificate is
issued for a *name*, not a port, so the port in the URL costs nothing
in validity - but it has to appear in every link, and in
`CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS` and
`REACT_APP_API_URL`. The script prints all three with the port
already in them.

Nothing listens on 80, so `http://munch.example.np` reaches nothing.

### If port 80 is taken locally but reachable

Windows reserves it readily, and not only through IIS. Anything
registered with HTTP.sys takes it in a way that reports
`An attempt was made to access a socket in a way forbidden by its
access permissions` rather than "address in use", and a kernel port
exclusion can outlive the service that caused it:

```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```

Port 80 appearing in that list means it is reserved whatever you stop.
Try freeing it first - `Stop-Service W3SVC -Force`, then
`net stop http /y` - and if it stays reserved, stop fighting it:

```powershell
.\deploy\windows\caddy\Install-Caddy.ps1 -Hostname munch.example.np -NoPort80
```

The certificate is then obtained over TLS-ALPN-01, which is answered
inside the TLS handshake on 443 and needs nothing on 80, at issue or
at renewal. The cost is the redirect: somebody typing
`http://munch.example.np` reaches nothing, because nothing is
listening there to send them on. Links have to say `https://`.

### If the Caddy service will not stay running

`SERVICE_PAUSED`, or a status of `Stopped` straight after starting,
means Caddy exited on startup and NSSM gave up restarting it. It says
why in its own log:

```powershell
Get-Content C:\caddy\caddy.err.log -Tail 40
```

Nearly always something already holding port 80 or 443:

```powershell
Get-NetTCPConnection -LocalPort 80,443 -State Listen |
    Select-Object LocalPort, OwningProcess
Get-Process -Id (Get-NetTCPConnection -LocalPort 80 -State Listen).OwningProcess
```

On Windows that is usually IIS, which installs listening on 80 and
starts itself:

```powershell
Stop-Service W3SVC -Force
Set-Service W3SVC -StartupType Disabled
Restart-Service Caddy
```

Only disable it if nothing else on this machine is served by IIS.

### If the certificate will not issue

Caddy says why in its log, and it is almost always one of three
things: the name does not resolve to this address, port 80 is not
reaching the machine, or Let's Encrypt's rate limit has been hit after
repeated failures. Test the first two from outside the network, not
from the server - a router that resolves its own public name
internally will tell you everything is fine when it is not.

## What this trades away

- **Python is serving files.** Slower than a web server, and
  irrelevant at the size of one event's resources. Caddy serves
  `/django-static/` and `/media/` off disk once it is in front.
- **One process.** Restarting it drops every open websocket; everyone
  reconnects.
- **Nothing restarts it.** Until the NSSM step above, closing the
  window stops the site.
- **Windows 10 22H2 is out of support** as of October 2025. On a
  closed network that is a judgement call; facing the internet it is
  worth raising with whoever owns the machine.

## When something is wrong

**Everything 400s with "Invalid HTTP_HOST header."** The address in
the browser is not in `ALLOWED_HOSTS`. Add the machine's IP.

**It works on the server, not from a phone.** The firewall rule, or
`-BindHost` — it must be `0.0.0.0`, not `127.0.0.1`.

**The page loads but the live room never connects.** Websockets. Check
`REACT_APP_API_URL` was not set to a relative path at build time.

**Admin loads unstyled.** `collectstatic` has not run, or
`STATIC_ROOT` is empty — note it lives at `config\staticfiles`, inside
`config\`, not at the repository root.

**Everything redirects forever once TLS is on.** `TRUST_PROXY_HEADER`
is not `True`, so Django cannot tell that the request arrived over
TLS - Caddy speaks plain HTTP to uvicorn - and `SECURE_SSL_REDIRECT`
sends it back to HTTPS again, and again.

**`/` shows a Django login form instead of the app.** The standalone
settings are not in use. `DJANGO_SETTINGS_MODULE` must be
`config.settings.standalone`; `config.settings.production` leaves the
root redirect in place for a proxy to override.
