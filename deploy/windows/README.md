# Deploying Munch natively on Windows

Written for: whoever is standing up or maintaining a Munch server on a
Windows host where WSL2 is not available.

**Use [`../wsl2/`](../wsl2/README.md) instead if you can.** It is the
better deployment, and the only reason not to is a host that cannot run
WSL2 at all — typically a virtual machine whose hypervisor does not
expose nested virtualization. Check first, because it is one command on
the hypervisor:

```powershell
Get-CimInstance Win32_Processor |
  Select-Object VirtualizationFirmwareEnabled, SecondLevelAddressTranslationExtensions
```

Both `True` means WSL2 will work and you are in the wrong file.

---

## What this costs

Two real limits, and it is worth knowing them before you start rather
than discovering them during an event.

**Concurrency.** Celery has no prefork pool on Windows. This
deployment uses a thread pool instead, which is genuine concurrency —
these tasks wait on networks and databases rather than on the CPU, and
both psycopg2 and the Django ORM are thread-safe — but it is threads in
one process, not processes across cores. Raise `-WorkerThreads` rather
than expecting the default to scale.

**Connections.** Daphne is built on Twisted, and Twisted on Windows
falls back to the `select()` reactor, which cannot watch more than 512
sockets. Every attendee in a hall holds a websocket open, so that
ceiling is the one thing this application cannot afford. **This
deployment runs uvicorn instead**, which uses asyncio's Proactor loop —
IOCP underneath, no such limit. Same ASGI application, no code change.
Daphne stays in `requirements.txt` and is simply not what runs here.

```
         :80/:443                      127.0.0.1:8000
browser ──────────▶ IIS ──────────────▶ uvicorn ──▶ Django
                  (ARR + URL Rewrite)                 │
                     + the SPA,                celery ┤ worker (threads)
                       django-static,                 │ beat
                       media from disk                ▼
                                            PostgreSQL + Memurai
```

Each step below ends in a **check**. Run it.

---

## 0. Fix the build

`CI=true` makes eslint warnings fatal, and the tree has one, so the
first build stops there. In
`Munch-frontend\src\attendee\pwa\BoardScreen.tsx`, line 201:

```diff
-  const { t, num } = useOrganizer();
+  const { t } = useOrganizer();
```

## 1. Install the dependencies

| | Where | Notes |
|---|---|---|
| Python 3.12 | python.org | Tick **Add python.exe to PATH** |
| Node 20 LTS | nodejs.org | Only needed to build the frontend |
| PostgreSQL 16 | postgresql.org | Remember the `postgres` password |
| **Memurai** | memurai.com | Redis for Windows — see below |
| NSSM | nssm.cc/download | `nssm.exe` from the **win64** folder |
| URL Rewrite 2.1 | iis.net | |
| ARR 3.0 | iis.net | |

**Redis is the one awkward dependency.** There is no official Redis for
Windows. Memurai is a Redis-compatible Windows service and its
Developer edition is free; it is what this deployment assumes. Do not
use the archived `MSOpenTech/redis` 3.x builds — they are a decade
unmaintained. If Redis must live elsewhere, point `REDIS_*` at it and
skip Memurai entirely.

IIS and its pieces:

```powershell
# Server
Install-WindowsFeature Web-Server, Web-WebSockets, Web-Mgmt-Console
# Windows 10/11
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServer, IIS-WebSockets -All
```

**Check:** `python --version`, `node --version`, `nssm version`, and
`redis-cli ping` → `PONG` (Memurai ships `redis-cli`; otherwise
`memurai-cli`).

## 2. Get the code and build it

```powershell
git clone <your remote> C:\munch
cd C:\munch

python -m venv venv
.\venv\Scripts\pip install -r requirements.txt -r deploy\windows\requirements-windows.txt
```

**Check:** `.\venv\Scripts\python -c "import uvicorn, celery, django; print('ok')"`

## 3. The database

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE USER munch WITH PASSWORD 'pick-something';"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE munch_db OWNER munch;"
```

## 4. The environment file

```powershell
copy deploy\windows\env.prod.example C:\munch\.env.prod
notepad C:\munch\.env.prod
```

Generate the secrets:

```powershell
.\venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(50))"
.\venv\Scripts\python -c "import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

Four values must name the same host, or you get failures that look
unrelated to each other:

| Variable | Form | Wrong value looks like |
|---|---|---|
| `ALLOWED_HOSTS` | `munch.example.np` | every request 400s |
| `CSRF_TRUSTED_ORIGINS` | `https://munch.example.np` | admin login 403s on POST |
| `CORS_ALLOWED_ORIGINS` | `https://munch.example.np` | API blocked in the browser only |
| IIS site binding | `munch.example.np` | the default site answers |

Leave `SECURE_SSL_REDIRECT=False` until a certificate exists. Then lock
the file down — it holds every secret here:

```powershell
icacls C:\munch\.env.prod /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)" "IIS_IUSRS:(R)"
```

**Check:** nothing is blank that you did not mean to skip.

## 5. Migrate, collect, build

```powershell
cd C:\munch
$env:DJANGO_ENV = 'prod'
$env:DJANGO_SETTINGS_MODULE = 'config.settings.production'

.\venv\Scripts\python manage.py migrate
.\venv\Scripts\python manage.py collectstatic --noinput
.\venv\Scripts\python manage.py createsuperuser

cd Munch-frontend
# Baked in at build time, not read at runtime. Unset, the app falls
# back to <protocol>//<hostname>:8000 and talks past IIS to a port
# that is not published - the API and every websocket fail, with
# nothing in the server log to show for it.
$env:REACT_APP_API_URL = 'https://munch.example.np/api/v1'
npm ci
$env:CI = 'true'; npm run build
```

**Check:** `C:\munch\Munch-frontend\build\index.html` exists, and
`C:\munch\config\staticfiles\admin\` is populated. Note that path —
`STATIC_ROOT` and `MEDIA_ROOT` are inside `config\`, not the repository
root, because `BASE_DIR` points at the settings package's parent.

## 6. The services

```powershell
.\deploy\windows\services\Install-MunchServices.ps1 -AppDir C:\munch -Nssm C:\tools\nssm.exe
```

**Check:**

```powershell
Get-Service Munch* | Format-Table -AutoSize
Invoke-WebRequest http://127.0.0.1:8000/admin/login/ -UseBasicParsing | Select StatusCode
```

A service that will not stay running says why in
`C:\munch\logs\<name>.err.log` — look there before the Event Log.

## 7. IIS

Create a site pointing at the **build output**, not the repository:

```powershell
Import-Module WebAdministration
New-Website -Name Munch -Port 80 -HostHeader munch.example.np `
    -PhysicalPath C:\munch\Munch-frontend\build

# Django's own assets and the uploaded media, served off disk.
New-WebVirtualDirectory -Site Munch -Name django-static -PhysicalPath C:\munch\config\staticfiles
New-WebVirtualDirectory -Site Munch -Name media         -PhysicalPath C:\munch\config\media

copy deploy\windows\iis\web.config C:\munch\Munch-frontend\build\web.config
```

Then the two machine-wide settings ARR needs. **Every rule in
`web.config` silently does nothing until the first one is set** — ARR
installs disabled:

```powershell
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/proxy' -Name enabled -Value True

Add-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/rewrite/allowedServerVariables' `
    -Value @{name='HTTP_X_FORWARDED_PROTO'}

iisreset
```

**Check:**

```powershell
Invoke-WebRequest http://munch.example.np/ -UseBasicParsing | Select StatusCode
Invoke-WebRequest http://munch.example.np/django-static/admin/css/base.css -UseBasicParsing | Select StatusCode
(Invoke-WebRequest http://munch.example.np/api/v1/ -UseBasicParsing -SkipHttpErrorCheck).StatusCode  # 401
```

A `502` means IIS is up and uvicorn is not. A `200` of the React page
where you expected the admin means the proxy rule did not match — ARR
is probably still disabled.

## 8. TLS

Bind a certificate to the site on 443 (win-acme, `wacs.exe`, is the
usual way to get a free one on Windows). Then, **in this order** —
flipping the flag before the binding exists makes every request a
redirect to a closed port:

```powershell
# C:\munch\.env.prod
SECURE_SSL_REDIRECT=True

Restart-Service MunchWeb, MunchWorker, MunchBeat
```

Update `CSRF_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` to `https://`,
rebuild the frontend with the `https://` API URL, and add
`https://munch.example.np/accounts/google/login/callback/` to Google
Cloud Console.

---

## Deploying a change

```powershell
cd C:\munch
git pull
.\venv\Scripts\pip install -r requirements.txt -r deploy\windows\requirements-windows.txt
$env:DJANGO_ENV='prod'; $env:DJANGO_SETTINGS_MODULE='config.settings.production'
.\venv\Scripts\python manage.py migrate
.\venv\Scripts\python manage.py collectstatic --noinput
cd Munch-frontend
$env:REACT_APP_API_URL='https://munch.example.np/api/v1'; $env:CI='true'
npm ci; npm run build
Restart-Service MunchWeb, MunchWorker, MunchBeat
```

## When something is wrong

**Everything 400s with "Invalid HTTP_HOST header."** The name in the
browser is not in `ALLOWED_HOSTS`. The exact value is in
`C:\munch\logs\django.log`.

**The page loads but nothing in it works.** The bundle is calling the
wrong place — `REACT_APP_API_URL` was unset at build time. Look for
calls to `:8000` in the browser's Network tab, then rebuild.

**The live room, transcript and guest hub never connect.** The
websocket upgrade is being dropped. Confirm the WebSocket Protocol
feature is installed (`Get-WindowsOptionalFeature -Online -FeatureName
IIS-WebSockets`) and that the `ws` rule is first in `web.config` — the
`django` rule below it would otherwise claim `/ws/` and strip the
upgrade.

**Admin and swagger load unstyled.** Django's assets are at
`/django-static/`, not `/static/` — the frontend owns that prefix.
`STATIC_URL` in `config/settings/production.py`, the virtual directory,
and the `spa` rule's exclusion list all have to agree.

**Redirect loop once TLS is on.** `HTTP_X_FORWARDED_PROTO` is not
reaching Django — the `allowedServerVariables` entry in step 7 is
missing, or `iisreset` was never run. uvicorn sees plain HTTP on
loopback whatever the browser used, so without that header Django
thinks the request is insecure and redirects it again.

**Periodic tasks run twice.** Two `MunchBeat` somewhere. Beat does not
share work out — each one fires every entry.

**Background work is slow but nothing is failing.** The worker's thread
pool is saturated. Re-run step 6 with a higher `-WorkerThreads`.

---

## What was tested, and what was not

The Django settings, the ASGI application under uvicorn, and the Celery
thread pool were all run and checked on Linux: the admin serves with
`/django-static/` asset URLs, an unknown `Host` gets a 400, the
websocket route reaches the auth layer rather than 404ing, the thread
pool starts with every task registered, and plain HTTP redirects to
HTTPS while a request carrying `X-Forwarded-Proto` returns 200 instead
of looping.

The IIS configuration, the NSSM service definitions and the PowerShell
were written against documented behaviour and **not executed** — there
was no Windows host to run them on. Step 7 is where that shows up if
something is wrong.
