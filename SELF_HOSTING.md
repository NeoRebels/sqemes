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

## Updating

**Docker bundle (Path B):**

```bash
cd selfhost
git pull                       # pull the new version
docker compose up -d --build   # rebuild + restart (init re-applies migrations idempotently)
```

**Bring-your-own-Supabase (Path A):** `git pull`, re-run `supabase db push` + `supabase functions
deploy`, then rebuild/redeploy the frontend.

On a self-hosted instance, Settings → **About** shows your running version and, when the
[release feed](https://github.com/NeoRebels/sqemes/releases) has a newer version, an "update
available" notice (SQEM-118). It's driven by `VITE_UPDATE_CHECK_URL` in the bundle `.env`
(defaults to the official Sqemes releases feed).

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
