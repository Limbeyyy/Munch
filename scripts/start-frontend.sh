#!/bin/bash
# Serve the frontend on the LAN so other devices can reach it.
#
# Binding to 0.0.0.0 is only half the job: the API URL is baked into the
# bundle at build time, so it must point at this machine's LAN address.
# Left as localhost, every visiting device would call its own localhost.
set -e

cd "$(dirname "$0")/.."

# Pick up REACT_APP_* and friends, then override the host-specific bits.
if [ -f .env ]; then
  set -a; source .env; set +a
fi

LAN_IP="${LAN_IP:-$(hostname -I | awk '{print $1}')}"
PORT="${PORT:-3001}"
API_PORT="${API_PORT:-8000}"

if [ -z "$LAN_IP" ]; then
  echo "Could not detect a LAN address; falling back to localhost." >&2
  LAN_IP="localhost"
fi

export HOST=0.0.0.0
export PORT
export REACT_APP_API_URL="http://${LAN_IP}:${API_PORT}/api/v1"
# The dev server otherwise rejects requests whose Host header is not localhost.
export DANGEROUSLY_DISABLE_HOST_CHECK=true
# Hot reload has to phone home to this machine, not to the visitor's.
export WDS_SOCKET_HOST="$LAN_IP"
export WDS_SOCKET_PORT="$PORT"
export BROWSER=none

cd Munch-frontend

# This tree needs --legacy-peer-deps; a dependency warning should not stop
# the server from starting.
npm install --legacy-peer-deps > /dev/null 2>&1 || \
  echo "npm install reported problems; starting with what is on disk." >&2

echo "Frontend      http://${LAN_IP}:${PORT}"
echo "API it calls  ${REACT_APP_API_URL}"
echo
echo "Camera, microphone and screen sharing need a secure context."
echo "Other devices on http:// will have them blocked by the browser."
echo "See scripts/LAN-SETUP.md for the two ways around that."
echo

npm start
