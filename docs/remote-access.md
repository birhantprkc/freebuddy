# Shared Access (Web UI)

Configure agents once on a host desktop, then let a small team use FreeBuddy
from browsers on the same local network. The desktop app hosts a WebUI server;
shared clients reuse the full UI and business logic with zero renderer changes.

## Quick start (LAN)

1. Desktop → **Settings → Shared** → toggle **Shared Access** on.
2. The first time you enable it, an **owner** account (`username: buddy`) is
   created and its password is revealed once — copy it.
3. Copy the access URL (e.g. `http://192.168.1.10:18080`) and open it from a
   browser on the same network.
4. Sign in with `buddy` + the password. Other users are added from the same
   **Settings → Shared → Users** section (admin-managed).

Each user has their own conversations, messages, scheduled tasks, workflow
runs, and workspace roots. The desktop owner (admin) can see everyone's data
for oversight; shared users only see their own.

## Environment variables

- `FB_REMOTE=1` — enable shared access on startup.
- `FB_REMOTE_PASSWORD=...` — seed/reset the owner password (≥ 8 chars).

## Server settings

**Settings → Shared → Server** controls where the WebUI listens:

- **Port** — defaults to `18080`. If the port is taken the server walks up to
  the next free one and the settings page reports which port it actually got.
- **Network exposure** — *Local network* binds `0.0.0.0`; *This machine only*
  binds `127.0.0.1`, which is what you want when a reverse proxy terminates TLS
  in front of FreeBuddy.

## Security notes

- The agent bridge stays bound to `127.0.0.1:17878` regardless of WebUI settings.
- Passwords are stored as scrypt hashes; sessions are HttpOnly + `SameSite=Strict`
  cookies so authenticated `<img>` / download requests work without exposing the
  token to JavaScript.
- Shared-access calls go through an explicit channel allow-list
  (`electron/shared/remoteChannelPolicy.ts`). Channels are `allow`, `adminOnly`
  or `deny`, and anything unclassified is refused — a contract test fails when a
  newly registered handler has not been categorised.
- The executable, arguments and environment used to spawn a CLI are resolved on
  the host from the stored adapter overrides. Values sent by a shared client are
  discarded, and `cwd` must fall inside that user's assigned directories.
- `settings:get` / `settings:set` are limited to a small key allow-list over the
  bridge, so the stored password hash is not readable from a browser.
- WebSocket session events (`cli://<sessionId>`) are delivered only to the owning
  user; desktop-only event channels are never forwarded to shared clients.
- Browsable workspace directories are assigned per user. **A member with no
  assigned directory can browse nothing**; only the owner falls back to the host
  home folder.
- Failed sign-ins are counted per IP + username. After five attempts the pair is
  locked out with an exponential backoff, capped at fifteen minutes.
- Deleting a user also deletes their conversations and scheduled tasks, and
  disabling or deleting an account (or changing its password) immediately
  invalidates its sessions and closes its WebSockets.

## Sessions and auditing

- **Settings → Shared** lists every signed-in device with its IP, browser and
  last-seen time. Sessions can be revoked individually, per user, or all at once.
- The **Activity log** records sign-ins, lockouts, account changes, directory
  changes and session revocations. The last 2000 entries are kept.

## Public / HTTPS deployment

The built-in server is plain HTTP, which is fine for a trusted LAN. **For
internet or any untrusted network, terminate TLS in a reverse proxy** in front
of the WebUI. The server itself intentionally does not manage certificates.

Set **Network exposure** to *This machine only* when you do this, so the plain
HTTP port is not reachable directly. The proxy should forward `X-Forwarded-For`
so session records and the activity log show the real client address.

Example with Caddy (automatic HTTPS):

```caddy
freebuddy.example.com {
    reverse_proxy 127.0.0.1:18080
}
```

Example with nginx + certbot:

```nginx
server {
    listen 443 ssl http2;
    server_name freebuddy.example.com;

    ssl_certificate     /etc/letsencrypt/live/freebuddy.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/freebuddy.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket (events + agent output stream)
    location /ws {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

To keep the WebUI reachable only via the proxy, leave shared access on but do
not expose `:18080` directly to the internet (firewall it, bind to localhost
behind the proxy, or run the proxy on the same host).

## Dev mode

When the desktop runs against the Vite dev server, the WebUI proxies HTTP and
Vite's HMR WebSocket to the dev server, so shared clients hot-reload during
development without manual refresh.
