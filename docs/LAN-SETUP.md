# Running on the LAN

Both servers bind `0.0.0.0` and work out the machine's LAN address themselves,
so there is nothing to edit when the address changes.

```bash
./scripts/start-django.sh     # backend  :8000
./scripts/start-frontend.sh   # frontend :3001
```

Each prints the URL to open. Other devices on the same network use the
frontend URL, for example `http://192.168.2.87:3001`.

To pin the address or the ports:

```bash
LAN_IP=192.168.2.90 PORT=3002 API_PORT=8000 ./scripts/start-frontend.sh
```

## Camera, microphone and screen sharing will be blocked

Browsers only expose `getUserMedia` and `getDisplayMedia` in a **secure
context**: HTTPS, or `localhost`. A plain `http://192.168.x.x` page is neither,
so on every device except this one the camera, the microphone and screen
sharing are unavailable. Everything else - joining, chat, attendance,
resources - works normally.

This is a browser rule, not something the app can switch off. Two ways round it.

### 1. Tell Chrome to trust the origin (quickest, per device)

On each visiting device open:

```
chrome://flags/#unsafely-treat-insecure-origin-as-secure
```

Add `http://192.168.2.87:3001` (use the address the script printed), set the
flag to **Enabled**, and relaunch the browser. Suitable for development on
machines you control; do not do this for anything public.

### 2. Serve over HTTPS (closer to production)

Generate a certificate for the LAN address and run both servers over TLS. The
certificate will be self-signed, so each device has to accept the warning once.
The frontend and backend must *both* be HTTPS - an HTTPS page cannot call an
HTTP API, the browser blocks it as mixed content.

## WebRTC between devices

Peer video uses public STUN only. That is enough for devices on one LAN. It is
not enough across the internet, where a TURN server is needed - add it to
`ICE_SERVERS` in `Munch-frontend/src/hooks/useWebRTC.ts`.

## Firewall

If other devices cannot connect, the ports are probably closed:

```bash
sudo ufw allow 3001/tcp
sudo ufw allow 8000/tcp
```
