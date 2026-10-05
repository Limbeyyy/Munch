# Deploying Munch on Windows Server, inside WSL2

Written for: whoever is standing up or maintaining a Munch server.

Munch is Django + Channels + Celery. Two of those are awkward on
Windows directly — Celery has no prefork pool there and runs one task
at a time, and Daphne falls back to Twisted's `select` reactor, which
caps concurrent connections around 512. Since the whole point of the
app is a hall full of people holding websockets open, that cap is the
one that matters.

So the stack runs in a WSL2 distro on the Windows box: real prefork
workers, a real `epoll` reactor, ordinary systemd units. Windows'
remaining job is to start WSL at boot and let traffic in.

```
         :80/:443                    127.0.0.1:8000
browser ──────────▶ Windows ──▶ nginx ──────────────▶ daphne ──▶ Django
                               (WSL2)                              │
                                                     celery ◀──────┤
                                                     worker + beat │
                                                                   ▼
                                                      PostgreSQL + Redis
```

Each step below ends in a **check**. Run it. A step that half-worked is
much cheaper to find where it happened than three steps later, where it
shows up as something unrelated.

---

## 0. Fix the build first

`update.sh` builds the frontend with `CI=true`, which makes eslint
warnings fatal — and the tree currently has one, so the first deploy
will stop there. One line, in
`Munch-frontend/src/attendee/pwa/BoardScreen.tsx:201`:

```diff
-  const { t, num } = useOrganizer();
+  const { t } = useOrganizer();
```

**Check:** `cd Munch-frontend && CI=true npm run build` ends in
`Compiled successfully.`

---

## 1. Prepare the Windows host

In an elevated PowerShell:

```powershell
wsl --version          # need 0.67.6+ for systemd; `wsl --update` if older
wsl --status           # expect: Default Version: 2
wsl --install -d Ubuntu-24.04
```

Windows Server usually has no Microsoft Store, and a plain
`wsl --install` goes through it. If the download fails or does
nothing, fetch the distro directly instead:

```powershell
wsl --install --no-distribution
wsl --install -d Ubuntu-24.04 --web-download
```

If `wsl --version` is not a recognised command at all, WSL itself is
missing: enable the two features, **reboot**, then install the distro.
`wsl --install` claims to do this in one go and then needs the restart
anyway, which is how a server ends up with the features on and no
distro registered.

```powershell
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
Restart-Computer
```

On a Windows host that is itself a virtual machine, nested
virtualization has to be on or WSL2 cannot start. Hyper-V, from the
*outer* host with the guest powered off:

```powershell
Set-VMProcessor -VMName "<the vm>" -ExposeVirtualizationExtensions $true
```

VMware calls it *Virtualize Intel VT-x/EPT*. Some cloud instance types
do not offer it at all, which rules this approach out entirely.

Whichever account runs these owns the distro. WSL registers them per
user profile, so note who you are (`whoami`) - step 6 has to run as
the same account.

Copy [`wslconfig.example`](wslconfig.example) to `C:\Users\<you>\.wslconfig`
(leading dot, no extension) and set `memory` / `processors` to what the
server can spare.

`networkingMode=mirrored` gives the distro the host's own addresses
and removes the port-forwarding problem entirely, but it needs
**Windows 11 22H2+ or Server 2025**. Everything older - Windows 10,
Server 2019, Server 2022 - silently ignores the key and uses NAT, so
the distro's address changes on every boot. That is the usual case,
and it is why step 6 registers a task that re-applies the forwarding
at every startup rather than setting it once.

Leave the line in either way: it is ignored where unsupported, and
correct if the machine is ever upgraded. `Setup-MunchHost.ps1`
detects which of the two you actually have.

`systeminfo | findstr /B /C:"OS Name" /C:"OS Version"` says which you
are on.

```powershell
wsl --shutdown
```

**Check:** `wsl -l -v` shows the distro `Stopped`, and `wsl --version`
reports 0.67.6 or newer.

## 2. Turn on systemd inside the distro

```bash
sudo cp /opt/munch/deploy/wsl2/wsl.conf /etc/wsl.conf   # after step 3, or write it by hand now
```

Then from PowerShell — this part is required, `wsl.conf` is only read
at boot:

```powershell
wsl --shutdown
wsl -d Ubuntu-24.04
```

**Check:** inside the distro, `pidof systemd` prints a number, and
`systemctl list-units --type=service` lists services rather than
erroring. If it says *System has not been booted with systemd*, the
`wsl --shutdown` did not happen or `/etc/wsl.conf` is not where it
should be.

## 3. Get the code in place

```bash
sudo mkdir -p /opt/munch
sudo chown "$USER" /opt/munch
git clone <your remote> /opt/munch
cd /opt/munch
```

Node 18+ is needed to build the frontend:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Check:** `node --version` is v18 or newer, and
`ls /opt/munch/manage.py` exists.

## 4. Write the environment file

```bash
cp deploy/wsl2/env.prod.example /opt/munch/.env.prod
$EDITOR /opt/munch/.env.prod
```

Generate the two secrets it asks for:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"          # SECRET_KEY, JWT_SECRET
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # ENCRYPTION_KEY
```

Four values must all name the same host or the app will half-work in
ways that are hard to read:

| Variable | Form | Fails as |
|---|---|---|
| `ALLOWED_HOSTS` | `munch.example.np` | Django 400s every request |
| `CSRF_TRUSTED_ORIGINS` | `https://munch.example.np` | admin and allauth login 403 on POST |
| `CORS_ALLOWED_ORIGINS` | `https://munch.example.np` | API calls blocked in the browser only |
| nginx `server_name` | `munch.example.np` | the default site answers instead |

Leave `SECURE_SSL_REDIRECT=False` until a certificate exists.

**Check:** no value is left blank except the optional ones —
`grep -nE '^[A-Z_]+=$' /opt/munch/.env.prod` should print only the
lines you meant to skip.

## 5. Install

```bash
sudo bash /opt/munch/deploy/wsl2/bin/install.sh
```

Installs PostgreSQL, Redis and nginx; creates the `munch` service
account, the role and the database; installs the systemd units and the
nginx site; then runs `update.sh` for the rest.

**Check:**

```bash
systemctl is-active munch-daphne munch-worker munch-beat nginx
curl -I http://localhost/            # 200, and the React index.html
curl -I http://localhost/django-static/admin/css/base.css   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/v1/   # 401, not 000 or 502
```

A 502 means nginx is up but Daphne is not — `journalctl -u munch-daphne -n 50`.

Create the first administrator:

```bash
cd /opt/munch
sudo -u munch DJANGO_ENV=prod DJANGO_SETTINGS_MODULE=config.settings.production \
    venv/bin/python manage.py createsuperuser
```

## 6. Publish it

Back in an elevated PowerShell, from the repository:

```powershell
.\deploy\wsl2\windows\Setup-MunchHost.ps1 -Distro Ubuntu-24.04
```

This registers a startup task that boots WSL and — under NAT — rebuilds
the port forwarding, since the distro's address changes on every boot.

Run it **as the same Windows account that installed the distro**. WSL
distros are registered per user profile, so a task running as a
different account — `SYSTEM` included — finds no distribution, and the
server comes back from a reboot with nothing listening and nothing in
the log to explain it. The script defaults to whoever invokes it.

**Check:** from another machine on the network, `http://<server ip>/`
loads the app. Then reboot the Windows box and check again **without
signing in** — that is the one thing the startup task exists for, and
a reboot is the only way to know it works.

## 7. TLS

With the name resolving to the server:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d munch.example.np
```

Then, **in this order** — turning the redirect on before the listener
exists makes every request a redirect to a closed port:

```bash
sed -i 's/^SECURE_SSL_REDIRECT=False/SECURE_SSL_REDIRECT=True/' /opt/munch/.env.prod
sudo systemctl restart munch.target
```

Point Google Cloud Console's authorised redirect URI at
`https://munch.example.np/accounts/google/login/callback/`.

---

## Deploying a change

```bash
cd /opt/munch && git pull
sudo bash deploy/wsl2/bin/update.sh
```

Migrations run before the frontend build, so a migration that will not
apply stops the deploy while the old bundle is still being served.

## Day to day

```bash
sudo systemctl status munch-daphne munch-worker munch-beat
sudo journalctl -u munch-daphne -f
sudo systemctl restart munch.target     # all three
tail -f /var/log/nginx/munch.error.log
```

## When something is wrong

**Everything 400s with "Invalid HTTP_HOST header."** The name in the
browser is not in `ALLOWED_HOSTS`. The exact value is in the Django
log.

**The page loads but nothing in it works.** The bundle is calling the
wrong place. `REACT_APP_API_URL` is baked in at build time, not read at
runtime — unset, the app falls back to `<protocol>//<hostname>:8000`
and talks past nginx to a port that is not published. Check the
Network tab for calls to `:8000`, then rebuild with it set.

**The live room, transcript and guest hub never connect.** The
websocket upgrade is being dropped. `/ws/` needs the `Upgrade` and
`Connection` headers that [`nginx/munch.conf`](nginx/munch.conf) sets
via the `$connection_upgrade` map; a proxy added in front of nginx
later has to pass them too.

**Admin and swagger load unstyled.** Django's assets are at
`/django-static/`, not `/static/` — the frontend owns that prefix.
`STATIC_URL` in `config/settings/production.py` and the nginx location
must agree.

**The box reboots and nothing answers.** WSL did not start. A distro
starts when something asks for it, and on an unattended server nothing
does. Check Task Scheduler for *Munch - start WSL and publish ports*;
re-run `Setup-MunchHost.ps1` if it is missing.

**It worked yesterday, not today, under NAT.** The distro's IP changed
and the forwarding still points at the old one.
`netsh interface portproxy show v4tov4` will show the stale address;
`Setup-MunchHost.ps1 -RefreshOnly` fixes it. Mirrored networking avoids
this for good.

**Periodic tasks run twice.** Two `munch-beat` somewhere. Beat does not
share work out — each one fires every entry. Exactly one, ever.

---

## Notes on the layout

- `STATIC_ROOT` and `MEDIA_ROOT` are **inside `config/`**, not at the
  repository root, because `BASE_DIR` points at the settings package's
  parent. The nginx `alias` paths reflect that.
- `.env.prod` is read twice: systemd loads it as `EnvironmentFile`, and
  `base.py` reads it again because `DJANGO_ENV=prod`. It must stay valid
  for both — no `export`, no inline comments after a value.
- The root URL `/` is the React app. Django's own `/` redirects to the
  allauth login page, so it is deliberately not proxied.
- `Dockerfile` and `docker-compose.yml` in the repository root are
  stale — they name `meeting_platform.*` (the project is `config.*`)
  and launch gunicorn, which is WSGI and cannot serve the websockets.
  Nothing here uses them.
