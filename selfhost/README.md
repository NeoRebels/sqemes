# Sqemes — self-host bundle (Path B: one-command Docker)

Stand up a **complete** Sqemes instance — the app **and** a full self-hosted Supabase
stack (Postgres, Auth, Storage, PostgREST, Realtime, edge functions) — with Docker Compose.
No separately-provisioned Supabase project required.

> **Status — SQEM-116.** Increment 1 (core stack): Supabase + app + init (migrations + bucket)
> — sign up and manage templates over HTTP. Increment 2: an optional **Caddy TLS reverse proxy**
> for a real domain and the **api sidecar** (MCP/OAuth + extension-config). See
> [Production: VPS + HTTPS](#production-vps--https) below.

The lighter alternative — point the app at your own Supabase project instead of bundling
one — is documented in the repo's top-level [`SELF_HOSTING.md`](../SELF_HOSTING.md) (Path A).

---

## Requirements

- **Docker** + **Docker Compose v2** (`docker compose version` ≥ 2.24 — needed for the
  `!override` merge tags).
- **~4 GB RAM.** The full Supabase stack is ~11 containers; a 1 GB VPS is not enough.
- `openssl` (to generate secrets).

## Quickstart

```bash
cd selfhost
cp .env.example .env

# 1. Generate the stack secrets (Postgres password, JWT secret, anon/service keys, …)
#    and paste them into .env, replacing the demo placeholders.
sh utils/generate-keys.sh

# 2. Generate the app's key-encryption secret and set it in .env:
#    API_KEY_ENCRYPTION_KEY=$(openssl rand -hex 32)

# 3. Bring it up (first run builds the app image + applies migrations).
docker compose up -d --build
```

Then open **http://localhost:3000**, sign up (that creates your workspace), and go to
**Settings → Integrations** to add an AI provider key (BYOK) to actually run prompts.

- App: http://localhost:3000
- Supabase API gateway (Kong): http://localhost:8000
- Supabase Studio (DB admin): http://localhost:8000 → login with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`

To follow startup / init progress:

```bash
docker compose logs -f init      # migration + bucket creation
docker compose logs -f app functions
```

## What comes up

| Service | Purpose |
|---|---|
| `db`, `auth`, `rest`, `storage`, `realtime`, `kong`, `meta`, `imgproxy`, `supavisor`, `studio` | Vendored upstream Supabase stack |
| `init` | One-shot: applies the repo's `supabase/migrations` + creates the private `workspace-files` bucket |
| `app` | The Sqemes SPA (built from source, served by nginx) |
| `api-sidecar` | Serves the repo's `/api` handlers (extension-config, MCP OAuth) — the Cloud Vercel functions |
| `functions` | Edge runtime serving the repo's `supabase/functions` |
| `caddy` *(TLS mode only)* | Reverse proxy + automatic HTTPS for a real domain |

## Verify (increment 1 acceptance)

1. `docker compose ps` — everything `healthy`; `init` exited `0`.
2. Sign up at http://localhost:3000 → you land in the app (no subscription gate; `SELF_HOSTED`).
3. Create, rename, and delete a template — persists across a refresh.
4. Settings → Integrations → add a provider key → it saves (exercises the edge functions).

## Configuration notes

- `SELF_HOSTED` / `VITE_SELF_HOSTED` are forced on by `docker-compose.sqemes.yml` — the
  subscription paywall is removed.
- **Rebuild after changing app-facing env** (`SUPABASE_PUBLIC_URL`, `ANON_KEY`): the SPA
  inlines them at build time — `docker compose up -d --build app`.
- **Email is optional.** With no `RESEND_API_KEY`, invites/reset fall back to a copyable link.
- Advanced trimming (drop `studio`/`supavisor`/`imgproxy` to save RAM) is possible with your
  own extra override file — left out of the default for fidelity to the upstream stack.

## Production: VPS + HTTPS

For a real deployment, enable the **Caddy** overlay — it fronts everything on one domain with
automatic Let's Encrypt TLS, and the app/Supabase/sidecar host ports become internal-only.

1. Point your domain's DNS at the server (an A record) and open ports **80** and **443**.
2. In `.env`:
   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.sqemes.yml:docker-compose.caddy.yml
   PROXY_DOMAIN=sqemes.example.com
   SUPABASE_PUBLIC_URL=https://sqemes.example.com
   API_EXTERNAL_URL=https://sqemes.example.com/auth/v1
   SITE_URL=https://sqemes.example.com
   ```
3. `docker compose up -d --build`

Caddy routes a single domain: `/auth`, `/rest`, `/storage`, `/functions`, `/realtime` → Kong;
`/.well-known/sqemes-extension-config`, `/.well-known/oauth-authorization-server`,
`/oauth/authorize` → the api sidecar; everything else → the app. TLS certs are provisioned on
first request and persisted in the `caddy_data` volume. (Studio is not exposed publicly — reach it
over an SSH tunnel to `kong:8000`/`studio:3000` if needed.)

## Layout

```
selfhost/
  docker-compose.yml          # vendored upstream Supabase stack (pristine — do not edit)
  docker-compose.sqemes.yml   # our overlay: app, init, api-sidecar, functions repoint (via !override)
  docker-compose.caddy.yml    # optional TLS reverse proxy overlay (VPS/HTTPS)
  .env.example                # upstream env + a Sqemes section
  Dockerfile.app              # production build of the SPA → nginx
  nginx.conf                  # SPA static serving
  init/apply.sh               # migration runner + bucket creation
  api-sidecar/                # Node server + Dockerfile serving the repo's /api handlers
  edge-main/index.ts          # edge-runtime dispatch router (--main-service target)
  volumes/proxy/caddy/Caddyfile  # Caddy routing (app / api-sidecar / kong)
  volumes/                    # vendored upstream config (kong, db init, pooler, …)
  utils/generate-keys.sh      # upstream secret generator
```

## Attribution

The vendored `docker-compose.yml`, `volumes/`, and `utils/` are from
[supabase/supabase](https://github.com/supabase/supabase) (`docker/`), Apache-2.0. See
[`NOTICE`](./NOTICE).
