#!/bin/bash
# Run the backend on the LAN.
#
# Django rejects any request whose Host header is not in ALLOWED_HOSTS, so the
# machine's LAN address is appended here rather than being hard-coded in .env
# where it would go stale the next time the address changes.
set -e

cd "$(dirname "$0")/.."
source venv/bin/activate

set -a
source .env
set +a

LAN_IP="${LAN_IP:-$(hostname -I | awk '{print $1}')}"
if [ -n "$LAN_IP" ]; then
  export ALLOWED_HOSTS="${ALLOWED_HOSTS},${LAN_IP}"
fi

echo "Backend  http://${LAN_IP:-0.0.0.0}:8000"
echo "Hosts    ${ALLOWED_HOSTS}"
echo

python manage.py runserver 0.0.0.0:8000
