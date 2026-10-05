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

## What you need

| | Where | Note |
|---|---|---|
| Python 3.12 | python.org | tick **Add python.exe to PATH** |
| Node 20 LTS | nodejs.org | only to build the frontend |
| PostgreSQL 16 | postgresql.org | |
| Memurai | memurai.com | Redis for Windows; Developer edition is free |

No IIS, no ARR, no URL Rewrite, no NSSM.

## First time

```powershell
git clone <your remote> C:\munch
cd C:\munch
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt -r deploy\windows\requirements-windows.txt
```

The database:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE USER munch WITH PASSWORD 'pick-something';"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE munch_db OWNER munch;"
```

The environment:

```powershell
copy deploy\windows\env.prod.example C:\munch\.env.prod
notepad C:\munch\.env.prod
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
