# Remote Access (Web UI)

FreeBuddy can be accessed from a browser on your phone, tablet, or another
computer. The desktop app hosts a WebUI server; remote clients reuse the full
UI and business logic with zero renderer changes.

## Quick start (LAN)

1. Desktop → **Settings → Remote** → toggle **Allow remote access** on.
2. The first time you enable it, an **owner** account (`username: owner`) is
   created and its password is revealed once — copy it.
3. Copy the access URL (e.g. `http://192.168.1.10:18080`) and open it from a
   browser on the same network.
4. Sign in with `owner` + the password. Other users are added from the same
   **Settings → Remote → Users** section (admin-managed).

Each user has their own conversations, messages, scheduled tasks, workflow
runs, and workspace roots. The desktop owner (admin) can see everyone's data
for oversight; remote users only see their own.

## Environment variables

- `FB_REMOTE=1` — enable remote access on startup.
- `FB_REMOTE_PASSWORD=...` — seed/reset the owner password (≥ 8 chars).

## Security notes

- The WebUI listens on `:18080`; the agent bridge stays bound to `127.0.0.1:17878`.
- Passwords are stored as scrypt hashes; sessions are HttpOnly + `SameSite=Strict`
  cookies so authenticated `<img>` / download requests work without exposing the
  token to JavaScript.
- WebSocket session events (`cli://<sessionId>`) are delivered only to the owning
  user; desktop-only event channels are never forwarded to remote clients.
- Browsable workspace directories are constrained per user by an allowlist
  (`Settings → Remote → Browsable workspace roots`); empty defaults to the host
  home folder.

## Public / HTTPS deployment

The built-in server is plain HTTP, which is fine for a trusted LAN. **For
internet or any untrusted network, terminate TLS in a reverse proxy** in front
of the WebUI. The server itself intentionally does not manage certificates.

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

To keep the WebUI reachable only via the proxy, leave remote access on but do
not expose `:18080` directly to the internet (firewall it, bind to localhost
behind the proxy, or run the proxy on the same host).

## Dev mode

When the desktop runs against the Vite dev server, the WebUI proxies HTTP and
Vite's HMR WebSocket to the dev server, so remote clients hot-reload during
development without manual refresh.
