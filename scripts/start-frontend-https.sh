#!/bin/bash
# Run the frontend over HTTPS on the LAN with a self-signed cert.
#
# This is a no-domain option for private IP testing on mobile devices.
# The browser still requires the origin to be secure, so the frontend must
# be served over HTTPS. For a full PWA on iPhone, the API must also be HTTPS
# or behind the same TLS origin.
set -e

cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required for local HTTPS without a domain." >&2
  echo "Install it and rerun:" >&2
  echo "  choco install mkcert" >&2
  echo "  or: winget install FilippoCavallarin.mkcert" >&2
  echo "  or: brew install mkcert" >&2
  exit 1
fi

LAN_IP="${LAN_IP:-$(hostname -I | awk '{print $1}' 2>/dev/null || echo localhost)}"
PORT="${PORT:-3001}"
API_PORT="${API_PORT:-8000}"
CERT_DIR="${CERT_DIR:-$PWD/.certs}"

mkdir -p "$CERT_DIR"

# Generate a cert valid for localhost and this machine's private LAN IP.
mkcert -install >/dev/null 2>&1 || true
mkcert -cert-file "$CERT_DIR/local-cert.pem" -key-file "$CERT_DIR/local-key.pem" \
  "$LAN_IP" localhost 127.0.0.1 0.0.0.0 >/dev/null 2>&1 || {
    echo "Could not generate the local certificate." >&2
    exit 1
  }

export HOST=0.0.0.0
export PORT
export HTTPS=true
export SSL_CRT_FILE="$CERT_DIR/local-cert.pem"
export SSL_KEY_FILE="$CERT_DIR/local-key.pem"
export REACT_APP_API_URL="https://${LAN_IP}:${API_PORT}/api/v1"
export DANGEROUSLY_DISABLE_HOST_CHECK=true
export WDS_SOCKET_HOST="$LAN_IP"
export WDS_SOCKET_PORT="$PORT"
export BROWSER=none

cd Munch-frontend

npm install --legacy-peer-deps > /dev/null 2>&1 || \
  echo "npm install reported problems; starting with what is on disk." >&2

echo "Frontend      https://${LAN_IP}:${PORT}"
echo "API it calls  https://${LAN_IP}:${API_PORT}/api/v1"
echo

echo "This is a self-signed cert for local testing only."
echo "Your iPhone must trust the local certificate once in Safari/Settings."
echo "If the API still blocks, serve it under the same HTTPS origin too."
echo

npm start
