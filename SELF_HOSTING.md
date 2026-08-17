# Self-Hosting Sqemes

Sqemes is **open core**: the AI management platform, MCP server, and Chrome
extension are open source (**AGPL-3.0** from v1.10.0; Apache-2.0 up to and including v1.9.5) and run
on your own infrastructure with your own AI provider keys (BYOK). A few pieces are **Sqemes Cloud
only** and simply stay off when their secret is absent — nothing breaks.

> **What the AGPL means for you as a self-hoster: in practice, nothing.** Running it for your own
> team — however commercially — asks nothing of you. The obligation starts only if you *offer this
> software to other people as a service*, and then you owe those users the source of what you run,
> your modifications included.

> This guide ships with the public repo — it is what self-hosters read. It documents how a
> self-host instance is assembled and where the Cloud/open boundary sits.

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
| Connectors — Notion, Shopify, Outlook, MS Graph (your own OAuth apps) | Marketplace **submission review** + the super-admin review surface |
| Marketplace **reading** — browse, vote, copy a published template | — |

Every Cloud-only feature is gated on a secret — **absent secret → feature disabled, no crash**
(see the "Graceful degradation" table at the bottom). Set `SELF_HOSTED=true` (+ `VITE_SELF_HOSTED=true`)
and there is no subscription model at all.

---

## Two ways to run it

There are exactly two deployment shapes, and the rest of this guide refers to them by name:

- **Path B — the Docker bundle.** Everything in one stack: the app *plus* a self-hosted Supabase,
  from `selfhost/`. This is what `install.sh` sets up and what most self-hosters want.
- **Path A — bring your own Supabase.** You run the frontend yourself and point it at a Supabase you
  already operate (Supabase Cloud or your own). See [Path A — bring your own Supabase](#path-a--bring-your-own-supabase).

---

## Path B — Docker bundle (manual install, step by step)

The one-command **[`install.sh`](install.sh)** is the easy path — it does everything below. To do it
by hand instead:

```bash
git clone https://github.com/NeoRebels/sqemes && cd sqemes/selfhost
bash setup.sh                 # generates strong secrets, then asks how you'll reach the instance
docker compose up --build -d
```

`setup.sh` covers every setup: **built-in Caddy** (auto-HTTPS; needs ports 80/443 free) · **behind your
existing Traefik** (auto-routed via the shipped `docker-compose.traefik.yml`) · **behind another proxy**
(nginx/…, you route it) · **server IP** (quick HTTP test). Non-interactive forms:
`bash setup.sh https://your.domain` (Caddy), `… --traefik`, `… --proxy`, or
`bash setup.sh http://<server-ip>:8000`. Changing the address later is an edit + `docker compose up -d`
(a restart, no rebuild).

---

## Secrets

The installer's **[`setup.sh`](selfhost/setup.sh)** (called by `install.sh`) runs
**[`generate-secrets.sh`](selfhost/generate-secrets.sh)**, which replaces the demo placeholders in
`.env` with **strong, unique random secrets** and a correctly-signed JWT trio (`JWT_SECRET` + matching
`ANON_KEY` / `SERVICE_ROLE_KEY`). A fresh install is therefore secure by default — you don't set these
by hand. (Both are idempotent: re-running does nothing once secrets exist.)

**If you skip the installer, the app refuses to start.** Running `docker compose up` straight from
the example file would serve an instance whose `ANON_KEY` and `SERVICE_ROLE_KEY` are Supabase's
public demo tokens — printed in their documentation, so anyone finding your instance could read and
write the whole database. Since v1.9.5 the app container checks for exactly that and stops with a
message instead of starting. On a fresh setup, fix it the way the message says:

```bash
cd selfhost && sh generate-secrets.sh
docker compose up -d
```

**On an instance that already has data, that is not enough** — most secrets bake into the database
on its first start, so a new `JWT_SECRET` will not match what is already there. That case is a
rotation: see *Change / rotate them* below, and back up `selfhost/volumes/` first.

If `generate-secrets.sh` answers *"JWT_SECRET is already custom — nothing to do"* while the app
still refuses to start, the two are looking at different values: the guard checks `ANON_KEY`, the
script checks `JWT_SECRET`. Someone changed one by hand and not the other, which breaks logins on
its own. Reset `JWT_SECRET` in `.env` to its `.env.example` value and run the script again — it
mints all three together.

There is no flag to switch the check off — an escape hatch would be used once "just to try it" and
then forgotten in production.

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

## Path A — bring your own Supabase

Everything above this point describes **Path B** (the bundled stack). If you already operate a
Supabase and only want the Sqemes frontend + edge functions on top of it, follow this path instead —
you do not need `selfhost/` at all.

**Prerequisites:**

- A **Supabase project** — Supabase Cloud (free tier is fine) or a self-hosted Supabase.
- **Node.js 22+** and the **Supabase CLI** (`npm i -g supabase`).
- **Docker** (optional) — to build/serve the frontend via the bundled `Dockerfile`.
- At least one **AI provider key** (BYOK) to actually run prompts — added later in the UI.

---

## Path A — setup

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
| `MARKETPLACE_PUBLISHER_TOKEN` | Marketplace stays **read-only** — browse, vote and copy still work; submitting is unavailable (SQEM-183). Set it in the app instead: Settings → General → Marketplace Publisher. |
| `VITE_MARKETPLACE_API_URL` **set to empty** | Marketplace disabled entirely and the nav item hides. Leaving it *unset* is the opposite — that reads the official Cloud marketplace. |

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

## Community marketplace (self-host)

The global marketplace is **Cloud-hosted, self-host-readable**. Your instance talks to it over a
public endpoint — there is no marketplace database of your own to run.

**Browsing works out of the box.** Browse, vote, and copy a published template into your workspace;
nothing to configure. Controlled by `VITE_MARKETPLACE_API_URL` in the bundle `.env`:

| Value | Effect |
|---|---|
| unset (default) | Reads the official Sqemes Cloud marketplace |
| a URL | Reads that instance's marketplace instead |
| **empty** | **Marketplace disabled** — the nav item hides entirely |

**Submitting your own templates** needs a **publisher token** (submissions are reviewed, so the
marketplace stays curated — it is invite-based today). Request one from Sqemes, then set it in the
app under **Settings → General → Marketplace Publisher**. It is stored **encrypted in your database**
and takes effect immediately — no restart, no rebuild. The env var `MARKETPLACE_PUBLISHER_TOKEN` in
`selfhost/.env` is the alternative if you'd rather configure it at deploy time.

Submit goes **through your api sidecar** (`/api/marketplace-submit`), which forwards to Cloud — the
`marketplace-submit` edge function itself is Cloud-only and is **not** part of this repo, along with
the server-side submission scan and the super-admin review surface. That split is deliberate: review
and anti-abuse stay on the side that owns the shared namespace. If you run your own reverse proxy,
route `/api/marketplace-submit` and `/api/marketplace-config` to the sidecar (see the routing table
below) — without them, submit and the token field fail.

---

## Connectors — external MCP tools

Connectors let a workspace attach third-party tools (Notion, Shopify, Outlook, Microsoft Graph) and
expose them inside Sqemes. They ship with self-host in full: `manage-connectors` plus the OAuth pair
`connector-oauth-start` / `connector-oauth-callback`, and one edge function per integration
(`mcp-notion`, `mcp-shopify`, `mcp-outlook`, `mcp-msgraph`).

Each connector is configured **per workspace in the UI**, with its own OAuth app credentials that you
register with the respective provider — there is no shared Sqemes-side app, so the redirect URI points
at *your* instance. Tokens are encrypted at rest with `API_KEY_ENCRYPTION_KEY`, the same key that
protects provider keys — which is the other reason never to change it after first use.

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
| `/.well-known/sqemes-extension-config`, `/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/api/marketplace-submit`, `/api/marketplace-config` | api-sidecar (`:8787`) |
| everything else (`/`, `/assets/*`) | app (`:80`, published on `:3000`) |

> **Route *all five* sidecar paths, not just the `.well-known` ones.** Miss `/api/marketplace-*` and
> the SPA fallback answers with `index.html` instead — so marketplace submit and the publisher-token
> field fail with a parse error rather than a 404, which is considerably harder to diagnose. This is
> the same trap as the extension-config endpoint above, and it bites the same way.

Then set `SUPABASE_PUBLIC_URL`, `SITE_URL`, `API_EXTERNAL_URL` (and `PROXY_DOMAIN`) to your domain.

### Traefik (Docker provider) — use the ready-made overlay

If your Traefik uses the Docker provider, don't hand-write labels — add the shipped overlay:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.sqemes.yml:docker-compose.traefik.yml
PROXY_DOMAIN=your.domain
# optional, only if your Traefik differs from these defaults:
# TRAEFIK_ENTRYPOINT=websecure
# TRAEFIK_CERTRESOLVER=letsencrypt
```

then `docker compose up -d`. Traefik auto-discovers the labels and routes the three backends above,
with TLS via your cert resolver. (`setup.sh` option 2 wires this for you.) Traefik reaches the
containers over the compose network — with `network_mode: host` Traefik it uses their bridge IPs,
which the host can route to.

For **other proxies** (nginx, etc.), keep your routing in a file *you* create (e.g.
`docker-compose.override.yml`, which Compose auto-loads) — **don't edit the shipped compose files**,
or every `git pull` will conflict.

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
git checkout v1.10.2       # pick a tag from github.com/NeoRebels/sqemes/releases
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

**GNU Affero General Public License v3** from **v1.10.0** onward — see [`LICENSE`](LICENSE).
Everything up to and including **v1.9.5 remains Apache-2.0**, permanently: that grant is irrevocable,
so a change can only apply going forward. Those releases are still published and are not being
removed.

**What it asks of you, concretely.** Running an instance — for your team, your company, your client
work, commercially or not — triggers nothing. The AGPL's network clause applies when you **offer this
software to third parties as a service**; then those users are entitled to the source of what you
run, your modifications included. That is the one case it was chosen for.

The open-core boundary above is unaffected: the proprietary Cloud pieces are separately gated and not
required to run a self-hosted instance. Bundled third-party components — the Supabase stack under
`selfhost/` among them — keep their own licenses; see [`NOTICE`](NOTICE).

---

*Last updated: 2026-08-16 (SQEM-222) — licence changed to **AGPL-3.0 from v1.10.0**; Apache-2.0
remains in force for every release up to and including v1.9.5, permanently, because that grant is
irrevocable. What it asks of a self-hoster is spelled out rather than left to be looked up: running
it triggers nothing, offering it to third parties as a service does. Version pin bumped.*

*2026-08-15 (SQEM-216) — documented the demo-key start guard shipped in v1.9.5: both
cases it can hit (fresh setup vs. an instance that already has data, where the fix is a rotation and
not a re-run) and the one dead end it can produce, because the guard checks `ANON_KEY` while
`generate-secrets.sh` checks `JWT_SECRET`.*

*2026-08-09 (SQEM-194) — added the marketplace and connectors sections, completed the reverse-proxy
routing table with the two `/api/marketplace-*` sidecar paths, and named the two install paths
(A / B) that the Updating section had been referring to without ever defining them.*
