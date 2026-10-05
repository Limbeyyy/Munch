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

## What this trades away

- **No TLS.** Plain HTTP. Fine on a closed network, not on the
  internet. uvicorn can take `--ssl-keyfile` / `--ssl-certfile`
  directly if you have a certificate.
- **Python is serving files.** Slower than a web server, and
  irrelevant at the size of one event's resources.
- **One process.** Restarting it drops every open websocket; everyone
  reconnects.
- **Nothing restarts it.** Until the NSSM step above, closing the
  window stops the site.

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

**`/` shows a Django login form instead of the app.** The standalone
settings are not in use. `DJANGO_SETTINGS_MODULE` must be
`config.settings.standalone`; `config.settings.production` leaves the
root redirect in place for a proxy to override.
