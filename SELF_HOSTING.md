# Self-Hosting Sqemes

Sqemes is **open core**: the prompt/template management platform, MCP server, and Chrome
extension are open source (Apache 2.0) and run on your own infrastructure with your own AI
provider keys (BYOK). A few pieces are **Sqemes Cloud only** and simply stay off when their
secret is absent — nothing breaks.

> Status: internal readiness guide (SQEM-056). It documents how a self-host instance is
> assembled and where the Cloud/open boundary sits.

---

## What runs self-host vs. what's Cloud-only

| ✅ Open source (self-host) | ☁️ Sqemes Cloud only |
|---|---|
| Core data model, prompt/assistant/skill management | Managed hosting & infrastructure |
| MCP server + OAuth (Claude Desktop / claude.ai) | Billing & subscriptions (Stripe) |
| Chrome extension | Platform "Sqemes AI" funded model |
| Multi-user workspaces, invites, roles | Transactional email delivery (Resend) |
| BYOK AI providers (OpenAI, Anthropic, Gemini, Mistral, …) | Error monitoring (Sentry) |
| Workspace file library + signed-URL delivery | Priority support / SLA, Enterprise SSO, audit logs |

Every Cloud-only feature is gated on a secret — **absent secret → feature disabled, no crash**
(see the "Graceful degradation" table at the bottom). Set `SELF_HOSTED=true` (+ `VITE_SELF_HOSTED=true`)
and there is no subscription model at all.

---

## Secrets

Running **[`selfhost/generate-secrets.sh`](selfhost/generate-secrets.sh)** (in the Quickstart) replaces
the demo placeholders in `.env` with **strong, unique random secrets** and a correctly-signed JWT trio
(`JWT_SECRET` + matching `ANON_KEY` / `SERVICE_ROLE_KEY`). A fresh install is therefore secure by
default — you don't set these by hand. (It's idempotent: re-running it does nothing once secrets exist.)

**View them** — all config lives in `.env` on the server; read it in your terminal:
```bash
grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|POSTGRES_PASSWORD|DASHBOARD_USERNAME|DASHBOARD_PASSWORD)=' selfhost/.env
```
The Supabase **Studio** dashboard (port 8000) login is `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

**Change / rotate them** — edit `.env` in the **terminal** (`nano`/`sed`), **not** a hosting panel's
YAML editor (it doesn't touch `.env`). Note: most secrets **bake into the database on the first
`docker compose up`**, so a fresh install is the clean time to set them. To rotate on an existing
instance, start fresh — `docker compose down -v`, delete `selfhost/volumes/`, then re-run
`generate-secrets.sh` (after resetting `JWT_SECRET` to its demo value) or set your own. The
`JWT_SECRET` / `ANON_KEY` / `SERVICE_ROLE_KEY` trio must stay consistent — if you change `JWT_SECRET`
by hand, regenerate the pair with the
[Supabase key generator](https://supabase.com/docs/guides/self-hosting/docker#securing-your-services).
**Never change `API_KEY_ENCRYPTION_KEY`** once provider keys are stored — it decrypts them.

What gets generated:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD`, `SECRET_KEY_BASE`, `API_KEY_ENCRYPTION_KEY`, `DASHBOARD_PASSWORD`, `S3_PROTOCOL_ACCESS_KEY_ID` / `_SECRET`, `MINIO_ROOT_PASSWORD` | random, 64 hex chars |
| `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY` | random, exactly 32 chars |
| `JWT_SECRET` | random, 64 hex chars |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | HS256 JWTs signed with `JWT_SECRET` (`role` + `iss` + `iat` + `exp`) |

Set your address (`SUPABASE_PUBLIC_URL`, `SITE_URL`, `API_EXTERNAL_URL`) via the Quickstart's `sed`
lines, and `PROXY_DOMAIN` if you use the bundled Caddy TLS overlay.

---

## Prerequisites

- A **Supabase project** — Supabase Cloud (free tier is fine) or a self-hosted Supabase.
- **Node.js 20+** and the **Supabase CLI** (`npm i -g supabase`).
- **Docker** (optional) — to build/serve the frontend via the bundled `Dockerfile`.
- At least one **AI provider key** (BYOK) to actually run prompts — added later in the UI.

---

## Setup

### 1. Clone & install
```bash
git clone <your-fork> sqemes && cd sqemes
npm install
```

### 2. Supabase project
Create a project, then note its **Project URL**, **publishable (anon) key**, and **service-role key**
(Project Settings → API). Link the CLI:
```bash
supabase link --project-ref <your-project-ref>
```

### 3. Database — apply migrations
```bash
supabase db push
```
This creates all tables, RLS policies, and functions.

### 4. Storage
Create a **private** storage bucket named **`workspace-files`** (Storage → New bucket). RLS for it
is installed by the migrations; the bucket itself must exist.

### 5. Auth email templates
For a fresh project, apply the templates in [`supabase/templates/`](supabase/templates/) via
**Authentication → Emails** in the dashboard. In particular the **Reset Password** template must use
the `token_hash` + `verifyOtp` link (see that folder's README) — the default `/verify` link is
consumed by email scanners and breaks reset.

### 6. Edge-function secrets + deploy
Set at least the core + self-host secrets (see [`.env.example`](.env.example) for the full list):
```bash
supabase secrets set \
  API_KEY_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  APP_URL="https://app.yourdomain.com" \
  SELF_HOSTED="true" \
  --project-ref <your-project-ref>
```
Then deploy the functions:
```bash
supabase functions deploy
```
The Cloud-only functions (`stripe-webhook`, `create-checkout-session`, `create-portal-session`)
deploy fine and simply return errors / stay unused without their Stripe secrets.

### 7. Frontend
Create `.env.local` from [`.env.example`](.env.example):
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_<...>
VITE_SELF_HOSTED=true
```
Build & serve — either with the bundled Docker image:
```bash
docker compose --profile preview up --build   # builds + serves on :3000
```
or directly:
```bash
npm run build        # → dist/
# serve dist/ behind any static host (nginx, Caddy, Vercel, etc.), SPA-fallback to index.html
```

### 8. First run
Sign up (creates your workspace), then **Settings → Integrations → add an AI provider key**
(BYOK). You can now author templates, chat, and connect the MCP server / extension.

---

## Bring Your Own Keys (BYOK)

Without `MISTRAL_API_KEY` there is no funded "Sqemes AI" model — every workspace uses its own
provider keys (added in Settings → Integrations), encrypted at rest with `API_KEY_ENCRYPTION_KEY`.

---

## Graceful degradation — what's absent on self-host

| Missing secret | Effect |
|---|---|
| `STRIPE_*` | No billing UI/flows; `SELF_HOSTED=true` removes the paywall entirely. |
| `MISTRAL_API_KEY` | No funded "Sqemes AI"; BYOK only. |
| `RESEND_API_KEY` | Invite emails don't send — the app shows a **copyable invite link** instead (SQEM-112). |
| `VITE_SENTRY_DSN` | No Sentry; structured console logging remains. |
| `PUBLIC_API_URL` | MCP/OAuth advertise the raw Supabase project URL instead of a custom domain. |
| `CRON_SECRET` | The abandoned-workspace cleanup cron is simply not scheduled. |

---

## Chrome extension (self-host)

Your instance exposes a public config-discovery endpoint served from the **api sidecar** (SQEM-063):

```
GET https://app.yourdomain.com/.well-known/sqemes-extension-config
→ { "supabaseUrl": "...", "supabaseAnonKey": "...", "appOrigin": "https://app.yourdomain.com" }
```

All three values are public by design (the anon key is *publishable*).

**Connecting the published extension (v2.6.0+).** In the extension's options page, under **Instance**,
enter your instance URL, click **Check**, then **Grant access & connect**. The extension fetches the
config above, requests access to your instance's origin(s) through Chrome's permission prompt, and
points itself at your instance — no rebuild or side-load. Cloud users keep the default
(`app.sqemes.com`) and notice nothing.

> **⚠️ Reverse-proxy requirement.** The discovery endpoint must be reachable **at the same origin the
> user enters** (your app URL). The bundled **Caddy** overlay already routes `/.well-known/*` (and the
> other sidecar routes) to the api sidecar, so a Caddy deploy works out of the box. If you run the app
> and sidecar behind your **own** reverse proxy (or on separate ports), you must route
> `GET /.well-known/sqemes-extension-config` on your app origin to the api sidecar — otherwise the app's
> SPA fallback answers with `index.html` and the extension can't discover the config. The endpoint emits
> `appOrigin` as `https://<host>`, so serve your instance over **HTTPS**.

**Custom sites (SQEM-122).** The same extension can also load the Sqemes widget on your own sites
(e.g. a self-hosted Copilot): add the site URL under options → **Custom sites**, grant access, and
reload that tab. Best-effort — the widget and template insertion work on standard text/contenteditable
composers; deeply site-specific behaviour (and exotic editors) may vary.

---

## Behind an existing reverse proxy (Traefik, nginx)

The bundled **Caddy overlay** (`docker-compose.caddy.yml`) publishes ports **80/443** and fetches its
own Let's Encrypt certificate — ideal on a fresh box, but it **collides** if you already run Traefik,
nginx, or another proxy on those ports.

To sit behind an existing proxy, **don't** add the Caddy overlay — keep just:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.sqemes.yml
```

That publishes the app on `${SQEMES_APP_PORT:-3000}`, Kong on `${KONG_HTTP_PORT:-8000}`, and the
api-sidecar on `${SQEMES_API_PORT:-8787}`. Point your proxy for your domain at these backends (the
same routing the bundled Caddy uses — services reachable as `app`, `kong`, `api-sidecar` on the
compose network, or via those host ports):

| Path(s) | → backend |
|---|---|
| `/auth/v1/*`, `/rest/v1/*`, `/graphql/v1`, `/realtime/v1/*`, `/storage/v1/*`, `/functions/v1/*`, `/mcp`, `/sso/*` | Kong (`:8000`) |
| `/.well-known/sqemes-extension-config`, `/.well-known/oauth-authorization-server`, `/oauth/authorize` | api-sidecar (`:8787`) |
| everything else (`/`, `/assets/*`) | app (`:80`, published on `:3000`) |

Then set `SUPABASE_PUBLIC_URL`, `SITE_URL`, and `API_EXTERNAL_URL` to your `https://` domain.

> **Keep your proxy config in your own file.** Put Traefik labels / a custom overlay in a file *you*
> create (e.g. `docker-compose.override.yml`, which Compose auto-loads) and add it to `COMPOSE_FILE` —
> **don't edit the shipped `docker-compose.caddy.yml`**, or every `git pull` will conflict.

---

## Updating

New versions are published to the [releases feed](https://github.com/NeoRebels/sqemes/releases).
On a self-hosted instance, **Settings → About** and the **sidebar footer** show your running version
and an "update available" notice when the feed has a newer one (SQEM-118 / SQEM-123). It's driven by
`VITE_UPDATE_CHECK_URL` in the bundle `.env` (defaults to the official Sqemes releases feed). So the
loop is: a new release is tagged → your instance flags it → you pull + rebuild.

### 1. Back up first

Updates re-apply migrations idempotently, but a backup is your safety net — especially before a
version that changes the schema.

```bash
# Docker bundle (Path B): dump the bundled Postgres
cd selfhost
docker compose exec -T db pg_dumpall -U postgres > backup-$(date +%F).sql
# (or stop the stack and snapshot the volumes/ directory)
```

For Path A (your own Supabase), use your provider's backup/point-in-time-restore.

### 2. Pin to a release (recommended)

Track **tags**, not `main`, so upgrades are deliberate and reproducible:

```bash
git fetch --tags
git checkout v1.1.0        # the version you want
```

### 3. Check for new env vars

Between versions the `.env.example` may gain new keys. Diff it and add anything missing to your
own `.env` **before** rebuilding:

```bash
git diff <old-tag> <new-tag> -- selfhost/.env.example
```

### 4. Apply the update

**Docker bundle (Path B):**

```bash
cd selfhost
docker compose up -d --build   # rebuild + restart; init re-applies migrations idempotently
```

**Bring-your-own-Supabase (Path A):**

```bash
supabase db push               # apply new migrations
supabase functions deploy      # update edge functions
npm ci && npm run build        # rebuild the frontend, then serve dist/ as before
```

**Downtime:** the rebuild/restart is a short interruption (seconds to a couple of minutes while
containers recreate); migrations run on startup.

### Rollback

Check out the previous tag and rebuild (`docker compose up -d --build`). If the update ran a
**schema-changing** migration, restore your pre-update database backup first — schema changes are
not auto-reverted by checking out older code.

---

## Test it locally

The bundled local stack is a self-host sandbox — a fresh **isolated local Supabase** (all migrations
applied) plus the app, on your machine:

```bash
npm run local:fresh          # starts local Supabase, resets the DB from migrations, runs the app
```

To exercise **self-host mode**, add `VITE_SELF_HOSTED=true` to `.env.local` (after `local:fresh`
writes it) and restart the app (`npm run local:up`). Sign up → you land **straight in the app with
no subscription gate** (a fresh workspace would otherwise hit the plan screen). This confirms the
migrations apply cleanly on a fresh DB and the self-host flag removes the paywall.

For prompts/chat to actually run you still need (a) a **BYOK** provider key (Settings →
Integrations) and (b) `SELF_HOSTED=true` reaching the edge functions — trivial on a real deploy
(`supabase secrets set SELF_HOSTED=true`); for the local stack, export it before `supabase start`.
A full end-to-end validation is simply following the **Setup** steps above against a throwaway
Supabase project.

---

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). The open-core boundary above is intentional: the
proprietary Cloud pieces are separately gated and not required to run a self-hosted instance.
