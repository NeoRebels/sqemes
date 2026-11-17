# Sqemes — self-host bundle (Path B: one-command Docker)

Stand up a **complete** Sqemes instance — the app **and** a full self-hosted Supabase
stack (Postgres, Auth, Storage, PostgREST, Realtime, edge functions) — with Docker Compose.
No separately-provisioned Supabase project required.

> **What is in the bundle.** The Supabase stack, the app, a one-shot `init` (migrations, the file
> bucket, the Vault entries Routines need) and the **api sidecar** (extension config, MCP OAuth,
> marketplace submit). `setup.sh` generates the secrets and wires one of three ways to reach the
> instance: the bundled **Caddy** proxy with automatic HTTPS, your existing **Traefik**, or your own
> reverse proxy. See [Production: VPS + HTTPS](#production-vps--https) below.

The lighter alternative — point the app at your own Supabase project instead of bundling
one — is documented in the repo's top-level [`SELF_HOSTING.md`](../SELF_HOSTING.md) (Path A).

---

## Requirements

- **Docker** + **Docker Compose v2** (`docker compose version` ≥ 2.24 — needed for the
  `!override` merge tags).
- **~4 GB RAM.** The stack runs 14 containers (11 from upstream Supabase plus `init`, `app` and
  `api-sidecar`; `init` exits once it is done), and 15 with the Caddy overlay. A 1 GB VPS is not
  enough.
- `openssl` (to generate secrets), `git` and `curl`.

## Quickstart

The one-command installer does all of it: it installs Docker if needed, clones the repo, runs
`setup.sh` and starts the stack. It asks only for your domain (press Enter for an IP-only test).

```bash
curl -fsSL https://raw.githubusercontent.com/NeoRebels/sqemes/main/install.sh | sh
```

By hand, from a clone:

```bash
cd selfhost
bash setup.sh                 # creates .env, runs generate-secrets.sh, asks how you reach the instance
docker compose up --build -d  # first run builds the app image and applies migrations
```

`setup.sh` copies `.env.example` to `.env`, then calls `generate-secrets.sh`, which replaces every
demo value with a random secret and mints a matching `JWT_SECRET` / `ANON_KEY` / `SERVICE_ROLE_KEY`
trio, including `API_KEY_ENCRYPTION_KEY`. It then writes your address into `.env` and picks the
compose files for the proxy you chose. Nothing has to be pasted by hand. Both scripts are safe to
re-run: once the secrets are generated, `generate-secrets.sh` leaves them alone.

Then open the address `setup.sh` printed (in IP test mode, **http://&lt;server-ip&gt;:3000**), sign
up (that creates your workspace), and go to **Settings → AI providers** to add an AI provider key
(BYOK) so Chat and your playbooks can run.

Without a proxy (IP test mode, or your own reverse proxy) the stack publishes:

- App: port 3000
- Supabase API gateway (Kong): port 8000
- api sidecar: port 8787
- Supabase Studio (DB admin): port 8000 → login with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`

To follow startup / init progress:

```bash
docker compose logs -f init      # migration + bucket creation
docker compose logs -f app functions
```

## What comes up

| Service | Purpose |
|---|---|
| `db`, `auth`, `rest`, `storage`, `realtime`, `kong`, `meta`, `imgproxy`, `supavisor`, `studio` | Vendored upstream Supabase stack |
| `init` | One-shot: applies the repo's `supabase/migrations` + creates the private `workspace-files` bucket + sets the two Vault entries Routines need (SQEM-679, on every start) |
| `app` | The Sqemes SPA (built from source, served by nginx) |
| `api-sidecar` | Serves the repo's `/api` handlers (extension-config, MCP OAuth, marketplace proxy) — the Cloud Vercel functions. TypeScript handlers are bundled to plain `.js` in the image's build stage (SQEM-399); the runtime stage is Node plus files, no npm dependency |
| `functions` | Edge runtime serving the repo's `supabase/functions` |
| `caddy` *(Caddy overlay only)* | Reverse proxy + automatic HTTPS for a real domain |

## Verify

1. `docker compose ps` — everything `healthy`; `init` exited `0`.
2. Sign up at your address → you land in the app (no subscription gate; `SELF_HOSTED`).
3. Create, rename, and delete a playbook; it persists across a refresh.
4. Settings → AI providers → add a provider key → it saves (exercises the edge functions).

## Configuration notes

- `SELF_HOSTED` / `VITE_SELF_HOSTED` are forced on by `docker-compose.sqemes.yml` — the
  subscription paywall is removed.
- **A restart is enough after changing the address** (`SUPABASE_PUBLIC_URL`, `SITE_URL`,
  `API_EXTERNAL_URL`) or `ANON_KEY`: the app writes them into its `config.js` on every container
  start (`docker-entrypoint.d/40-sqemes-config.sh`), so `docker compose up -d` applies them without a
  rebuild. Keep the `JWT_SECRET` / `ANON_KEY` / `SERVICE_ROLE_KEY` trio consistent.
- **Email is optional.** With no `RESEND_API_KEY`, invites fall back to a copyable link. With it, set
  `RESEND_FROM_EMAIL` to an address on a domain verified in your own Resend account; Resend usually
  refuses other senders, and empty means `sqemes <noreply@sqemes.com>`.
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

Caddy routes a single domain: `/auth/v1`, `/rest/v1`, `/graphql/v1`, `/realtime/v1`, `/storage/v1`,
`/functions/v1`, `/mcp` and `/sso` → Kong; `/.well-known/sqemes-extension-config`,
`/.well-known/oauth-authorization-server`, `/oauth/authorize` and everything under `/api/` → the api
sidecar (which today serves `/api/marketplace-submit` and `/api/marketplace-config`); everything
else → the app. TLS certs are provisioned on
first request and persisted in the `caddy_data` volume. (Studio is not exposed publicly — reach it
over an SSH tunnel to `kong:8000`/`studio:3000` if needed.)

## Layout

```
selfhost/
  docker-compose.yml          # vendored upstream Supabase stack (pristine — do not edit)
  docker-compose.sqemes.yml   # our overlay: app, init, api-sidecar, functions repoint (via !override)
  docker-compose.caddy.yml    # optional TLS reverse proxy overlay (VPS/HTTPS)
  docker-compose.traefik.yml  # optional overlay: route through your existing Traefik (Docker labels)
  setup.sh                    # first-time setup: .env, secrets, address, proxy choice
  generate-secrets.sh         # replaces the demo secrets with random ones + a matching JWT trio
  .env.example                # upstream env + a sqemes section
  Dockerfile.app              # production build of the SPA → nginx
  docker-entrypoint.d/        # run at app container start: demo-key guard, runtime config.js
  nginx.conf                  # SPA static serving
  init/apply.sh               # migration runner + bucket creation + Routines' Vault entries
  api-sidecar/                # Node server + two-stage Dockerfile (bundle api/*.ts, then plain Node) serving the repo's /api handlers
  edge-main/index.ts          # edge-runtime dispatch router (--main-service target)
  volumes/proxy/caddy/Caddyfile  # Caddy routing (app / api-sidecar / kong)
  volumes/                    # vendored upstream config (kong, db init, pooler, …)
  utils/generate-keys.sh      # upstream secret generator (not used by setup.sh)
```

## Attribution

The vendored `docker-compose.yml`, `volumes/`, and `utils/` are from
[supabase/supabase](https://github.com/supabase/supabase) (`docker/`), Apache-2.0. See
[`NOTICE`](./NOTICE).
