# Deploying Cruio

Cruio builds to a self-contained **Nitro `node-server`** bundle. State lives on
local disk (SQLite at `data/cruio.db` + uploads in `data/uploads/`), so the
target is **one host with a persistent disk** — a single VPS. There is no
object storage or remote DB to configure.

## ⚠️ Node version — use LTS, not 25

Run on **Node 22 or 24 LTS**. The production server currently **fails on Node 25
("Current")**: every request throws `TypeError: Invalid URL` from the alpha
SolidStart 2 / `srvx` server stack. `vite dev` is unaffected (different request
path), so this only bites the built server. Verify with `node --version` on the
box before deploying.

## 1. Prerequisites on the VPS

- Node 22 or 24 LTS, and `bun` (used to install/build).
- A non-root deploy user and an app directory.
- A persistent disk/volume for `data/`.

## 2. Get the code and build

```bash
git clone <repo> cruio && cd cruio
bun install
NODE_ENV=production bun run build
```

The build emits `.output/`. A Nitro `compiled` hook in `vite.config.ts` copies
the libsql native addon (`@libsql/<platform>/index.node`) into the bundle —
without it the server throws `MODULE_NOT_FOUND` on first DB access. It copies
whatever platform binary the build host has, so **build on the VPS** (or a
matching Linux environment), not on a dev machine of a different OS.

## 3. Persistent data

All state is under `data/` relative to the process working directory:

- `data/cruio.db` — SQLite database
- `data/uploads/` — uploaded files (named by UUID)

Put `data/` on the persistent volume — either run the service with its
`WorkingDirectory` on the volume, or symlink `data/` to a path on it. Losing
this directory loses everything.

The DB self-migrates on every boot (a hand-rolled `migrate()` + DDL +
`backfillLibrary()` in `src/db/index.ts`); for a fresh prod DB this is fine.
**Snapshot `data/` before the first prod boot and before any deploy.**

## 4. Environment

Provide these via a systemd `EnvironmentFile` or a non-committed `.env`
(see `.env.example` for the full list). `.env` is gitignored.

```
NODE_ENV=production
PORT=8787                      # internal port; Caddy proxies to it
BETTER_AUTH_SECRET=<openssl rand -hex 32>   # REQUIRED — server refuses to boot without it in prod
BETTER_AUTH_URL=https://cruio.example.com   # your public URL
APP_ORIGINS=https://cruio.example.com       # extra trusted origins (comma-separated)
```

`BETTER_AUTH_URL` and `APP_ORIGINS` feed `trustedOrigins` — better-auth rejects
auth POSTs (e.g. an invitee accepting an invite) from origins not listed. Use a
**fresh** secret; do not reuse the dev one.

## 5. Run under systemd

`/etc/systemd/system/cruio.service`:

```ini
[Unit]
Description=Cruio
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/cruio          # holds .output and data/ (on the volume)
EnvironmentFile=/srv/cruio/.env
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cruio
sudo journalctl -u cruio -f          # logs
```

## 6. TLS + reverse proxy (Caddy)

Point the domain's A/AAAA record at the VPS, then `/etc/caddy/Caddyfile`:

```
cruio.example.com {
    reverse_proxy localhost:8787
}
```

Caddy provisions HTTPS automatically. (nginx + certbot is the alternative.)

## 7. AI assistant (optional)

The assistant is disabled (clean 503) unless configured. Pick one:

- **Self-hosted llama.cpp via Cloudflare tunnel** — expose your local
  `llama-server` with a tunnel, then set on the VPS:
  ```
  AI_PROTOCOL=openai
  AI_BASE_URL=https://<your-tunnel-host>
  AI_MODEL=<id your server serves>
  ```
  This talks straight to llama.cpp's OpenAI-compatible `/v1/chat/completions`
  (see `src/lib/ai/openai.ts`) — no LiteLLM/translation layer. Leave
  `ANTHROPIC_API_KEY` unset.
- **Real Anthropic API** — set `ANTHROPIC_API_KEY`, leave `AI_BASE_URL` unset
  (defaults to `AI_PROTOCOL=anthropic`). Real per-token cost; no usage cap is
  enforced yet.

## 8. Backups

Snapshot `data/cruio.db` + `data/uploads/` off-box on a schedule (cron, or
Litestream for continuous SQLite replication).

## Post-deploy smoke test

1. Sign up → create workspace → sign out → sign back in (proves secret + origins).
2. Create an invite in Settings → Members, copy the link, accept from a second
   account (proves trusted origins end to end).
3. Create a project → deliverable → upload an image → download it and the ZIP
   (proves uploads land on the volume and file-serving auth works).
4. Restart the service and confirm data survives (proves `data/` is persistent).
5. If AI is configured, send a message and ask it to create a task, then reload
   the thread (proves the transport + persistence round-trip).
