# Sqemes

**Sqemes is where your team's AI know-how lives.**

Build and organize reusable **prompts, assistants, and skills** once — then use them everywhere you
work, through three channels:

- 🧩 **Browser extension** — drop them into ChatGPT, Claude, Gemini, or any chat site
- 💬 **Sqemes chat** — run them against your own model keys (bring-your-own-key)
- 🔌 **MCP** — expose them to Claude Desktop, Cursor, or any MCP client

Self-hostable and open-source — own your data. Under the hood everything is one `Template` model
distinguished by `kind` (prompt / assistant / skill), so what you author once works across all three
channels.

This repository is the **open core**: the full app + backend you can run on your own
infrastructure. Sqemes Cloud adds hosted convenience and a few proprietary pieces — none of
them are required to self-host.

## Quickstart (Docker)

The bundled stack stands up a whole instance — the app plus a self-hosted Supabase (Postgres, Auth,
Storage, PostgREST, Realtime, edge functions), no separate Supabase project needed.

**You'll need** a server with ~4 GB RAM and — for anything beyond local testing — a **domain pointed
at it** (HTTPS is required for the browser extension, OAuth, and MCP).

Copy-paste the whole block. **The only thing to edit are the three URLs in step 3** — set them to your
domain, or to your server's IP for a quick test (the default `localhost` only works *on the server
itself*):

```bash
# 1. Install Docker (skip if you already have it)
curl -fsSL https://get.docker.com | sh

# 2. Clone the repo
git clone https://github.com/NeoRebels/sqemes && cd sqemes/selfhost

# 3. Create config + set your address — EDIT these 3 URLs (your domain, or http://<server-ip>:8000 / :3000)
cp .env.example .env
sed -i 's#^SUPABASE_PUBLIC_URL=.*#SUPABASE_PUBLIC_URL=https://sqemes.example.com#'   .env
sed -i 's#^SITE_URL=.*#SITE_URL=https://sqemes.example.com#'                         .env
sed -i 's#^API_EXTERNAL_URL=.*#API_EXTERNAL_URL=https://sqemes.example.com/auth/v1#' .env

# 4. Build and start
docker compose up --build -d
```

No editor needed — the `sed` lines write the URLs for you. The first build takes a few minutes; then
check it's up with `docker compose ps` (everything `healthy`/`running`).

### Open your instance

The app is on **port 3000** — open `http://<your-server>:3000` (or your domain) and **sign up** (the
first account creates your workspace), then add a provider key under **Settings → Integrations**
(bring-your-own-key). *Port 8000 is the Supabase dashboard (Studio), not the app.*

Changing the address later is just an edit + `docker compose up -d` (a **restart — no rebuild**).

### Secrets — before you go public

`.env` ships with **public demo keys** — fine for a private test, but **regenerate them before the
instance is internet-facing** (the demo JWT keys are well-known, so anyone could mint admin tokens).
Most are random (`openssl rand -hex 32`); the `JWT_SECRET` + `ANON_KEY` + `SERVICE_ROLE_KEY` trio must
match, so use the **[Supabase key generator](https://supabase.com/docs/guides/self-hosting/docker#securing-your-services)**.
Set them **before the first start** (they bake into the database). Full list + commands:
**[SELF_HOSTING.md → Secrets you must change](./SELF_HOSTING.md#secrets-you-must-change)**.

### Domain + HTTPS

For a real domain with automatic HTTPS, add the bundled Caddy overlay, or route your existing
Traefik/nginx to the stack: **[SELF_HOSTING.md → Behind an existing reverse proxy](./SELF_HOSTING.md#behind-an-existing-reverse-proxy-traefik-nginx)**.

Full instructions — a bring-your-own-Supabase alternative and connecting the Chrome extension — are
in **[SELF_HOSTING.md](./SELF_HOSTING.md)**.

## Use the Chrome extension with your instance

The published Sqemes extension can point at your self-hosted instance at runtime — no
rebuild. In the extension options → **Instance**, enter your instance URL → **Check** →
**Grant access & connect**. See
[SELF_HOSTING.md → Chrome extension](./SELF_HOSTING.md#chrome-extension-self-host).

## Tech

React + TypeScript + Vite frontend · Supabase (Postgres / Auth / Storage / Realtime / Edge
Functions) backend · Docker for self-hosting.

## Contributing & security

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — local dev setup and PR conventions.
- **[SECURITY.md](./SECURITY.md)** — report a vulnerability privately.
- **[Code of Conduct](./CODE_OF_CONDUCT.md)**.

## License

[Apache License 2.0](./LICENSE). Bundled third-party components (the self-hosted Supabase
stack under `selfhost/`) retain their own licenses — see [NOTICE](./NOTICE).
