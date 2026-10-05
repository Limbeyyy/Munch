#!/usr/bin/env bash
#
# First-time setup of a Munch instance inside a WSL2 distro.
#
# Idempotent: safe to run again after a partial failure. It installs
# packages, creates the service account, the database and the Redis
# server, then hands over to update.sh for the parts that run on every
# deploy.
#
#   sudo bash /opt/munch/deploy/wsl2/bin/install.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/munch}"
APP_USER="${APP_USER:-munch}"
DB_NAME="${DB_NAME:-munch_db}"
DB_USER="${DB_USER:-munch}"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mx\033[0m %s\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo."
[[ -d "$APP_DIR" ]] || die "$APP_DIR does not exist. Clone the repository there first."

# systemd is off by default in WSL2 and everything here is a systemd
# unit, so there is no point going further without it.
if ! pidof systemd >/dev/null 2>&1; then
    die "systemd is not running in this distro.
     Put this in /etc/wsl.conf (see deploy/wsl2/wsl.conf):

       [boot]
       systemd=true

     then, from Windows: wsl --shutdown, and start the distro again."
fi

say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    python3 python3-venv python3-dev \
    postgresql postgresql-contrib libpq-dev \
    redis-server \
    nginx \
    build-essential curl git

say "Starting PostgreSQL and Redis"
systemctl enable --now postgresql redis-server

say "Creating the service account"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    adduser --system --group --home "$APP_DIR" --no-create-home "$APP_USER"
fi

say "Creating the database"
DB_PASSWORD="${DB_PASSWORD:-}"
if [[ -z "$DB_PASSWORD" ]]; then
    if [[ -f "$APP_DIR/.env.prod" ]]; then
        DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$APP_DIR/.env.prod" | cut -d= -f2- || true)"
    fi
fi
[[ -n "$DB_PASSWORD" ]] || die "Set DB_PASSWORD in $APP_DIR/.env.prod (or in the environment) first."

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
    ELSE
        ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
    END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

# Django's test runner creates and drops its own database, which an
# ordinary role may not do. Harmless here, and it is the difference
# between being able to run the suite on this box and not.
sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE ${DB_USER} CREATEDB;"

say "Installing the systemd units"
install -m 644 "$APP_DIR"/deploy/wsl2/systemd/munch-*.service /etc/systemd/system/
install -m 644 "$APP_DIR"/deploy/wsl2/systemd/munch.target     /etc/systemd/system/
systemctl daemon-reload
systemctl enable munch-daphne munch-worker munch-beat munch.target

say "Installing the nginx site"
install -m 644 "$APP_DIR/deploy/wsl2/nginx/munch.conf" /etc/nginx/sites-available/munch
ln -sfn /etc/nginx/sites-available/munch /etc/nginx/sites-enabled/munch
rm -f /etc/nginx/sites-enabled/default
# nginx must be able to traverse into the app directory to read the
# built frontend and the collected static files.
chmod o+x "$APP_DIR"
nginx -t
systemctl enable --now nginx

say "Building and starting the application"
bash "$APP_DIR/deploy/wsl2/bin/update.sh"

cat <<DONE

  Installed.

  Next, on the Windows side, so the server is reachable from outside
  this distro - see deploy/wsl2/README.md, "Reaching it from the
  network":

      deploy\\wsl2\\windows\\Setup-MunchHost.ps1

  Check it from inside WSL first:

      curl -I http://localhost/

DONE
