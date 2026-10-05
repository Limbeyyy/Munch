#!/usr/bin/env bash
#
# Deploy the current checkout: dependencies, migrations, the frontend
# bundle, then a restart.
#
#   sudo bash /opt/munch/deploy/wsl2/bin/update.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/munch}"
APP_USER="${APP_USER:-munch}"
VENV="$APP_DIR/venv"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mx\033[0m %s\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo."
[[ -f "$APP_DIR/.env.prod" ]] || die "$APP_DIR/.env.prod is missing. Copy deploy/wsl2/env.prod.example and fill it in."

export DJANGO_ENV=prod
export DJANGO_SETTINGS_MODULE=config.settings.production

say "Python dependencies"
[[ -d "$VENV" ]] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

say "Database migrations"
# Before the frontend build, which is the slow part: a migration that
# will not apply should stop the deploy while the old bundle is still
# the one being served.
( cd "$APP_DIR" && "$VENV/bin/python" manage.py migrate --noinput )

say "Django static files"
( cd "$APP_DIR" && "$VENV/bin/python" manage.py collectstatic --noinput )

say "Frontend bundle"
command -v npm >/dev/null || die "npm not found. Install Node 18 or newer."
(
    cd "$APP_DIR/Munch-frontend"

    # Baked in at build time, not read at runtime. Left unset, the app
    # falls back to <protocol>//<hostname>:8000 and talks past nginx to
    # a port that is not published - the API and every websocket fail
    # with nothing in the server log to show for it.
    if [[ -z "${REACT_APP_API_URL:-}" ]]; then
        origin="$(grep -E '^CORS_ALLOWED_ORIGINS=' "$APP_DIR/.env.prod" \
                  | cut -d= -f2- | cut -d, -f1 | tr -d '[:space:]')"
        [[ -n "$origin" ]] || die "Set REACT_APP_API_URL, or CORS_ALLOWED_ORIGINS in .env.prod, so the bundle knows its own API."
        export REACT_APP_API_URL="${origin}/api/v1"
    fi
    echo "    REACT_APP_API_URL=$REACT_APP_API_URL"

    npm ci --no-audit --no-fund
    # CI=true makes eslint warnings fatal, which is what catches a
    # bundle that would have shipped broken.
    CI=true npm run build
)

say "Permissions"
mkdir -p "$APP_DIR/logs" "$APP_DIR/config/media" "$APP_DIR/config/staticfiles"
chown -R "$APP_USER:$APP_USER" \
    "$APP_DIR/logs" "$APP_DIR/config/media" "$APP_DIR/config/staticfiles"
chown "$APP_USER:$APP_USER" "$APP_DIR/.env.prod"
chmod 600 "$APP_DIR/.env.prod"

say "Restarting"
systemctl restart munch.target
systemctl reload nginx

sleep 2
systemctl is-active --quiet munch-daphne || die "Daphne did not come up. journalctl -u munch-daphne -n 50"
systemctl is-active --quiet munch-worker || die "The worker did not come up. journalctl -u munch-worker -n 50"
systemctl is-active --quiet munch-beat   || die "Beat did not come up. journalctl -u munch-beat -n 50"

say "Up. $(systemctl is-active munch-daphne munch-worker munch-beat | tr '\n' ' ')"
