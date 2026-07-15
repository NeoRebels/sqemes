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

**You'll need** a server with ~4 GB RAM (the stack is ~15 containers) and — for anything beyond local
testing — a **domain pointed at it** (HTTPS is required for the browser extension, OAuth, and MCP).

```bash
# 1. Install Docker (skip if you already have it) — official convenience script
curl -fsSL https://get.docker.com | sh

# 2. Clone the repo
git clone https://github.com/NeoRebels/sqemes && cd sqemes/selfhost

# 3. Create your config file and open it to edit
cp .env.example .env
nano .env      # editor opens — save with Ctrl+O then Enter, exit with Ctrl+X
```

Now **edit `.env` right here in the terminal** (not a hosting panel's YAML editor) and set two things
before saving:

**a) Your address** — where you'll actually reach the instance. A **domain over HTTPS** is strongly
recommended; for a quick test use your server's **IP** (the default `localhost` only works *on the
server itself*):
```
SUPABASE_PUBLIC_URL=https://sqemes.example.com        # test: http://<server-ip>:8000
SITE_URL=https://sqemes.example.com                   # test: http://<server-ip>:3000
API_EXTERNAL_URL=https://sqemes.example.com/auth/v1   # test: http://<server-ip>:8000/auth/v1
```
For a domain + automatic HTTPS, add a reverse proxy — the bundled Caddy overlay, or your existing
Traefik/nginx: **[SELF_HOSTING.md → Behind an existing reverse proxy](./SELF_HOSTING.md#behind-an-existing-reverse-proxy-traefik-nginx)**.
Changing the address later is just an edit + `docker compose up -d` (**restart, no rebuild**).

**b) Secrets** — the defaults are **public demo keys**, unsafe for a public instance (anyone could
mint admin tokens). Replace them **before this first start** (they bake into the database):
- Random values — `openssl rand -hex 32` each: `POSTGRES_PASSWORD`, `SECRET_KEY_BASE`, `VAULT_ENC_KEY`,
  `PG_META_CRYPTO_KEY`, `API_KEY_ENCRYPTION_KEY`, `DASHBOARD_PASSWORD`, `S3_PROTOCOL_ACCESS_KEY_ID`,
  `S3_PROTOCOL_ACCESS_KEY_SECRET`, `MINIO_ROOT_PASSWORD`.
- `JWT_SECRET` + `ANON_KEY` + `SERVICE_ROLE_KEY` must **match** — generate them together with the
  **[Supabase key generator](https://supabase.com/docs/guides/self-hosting/docker#securing-your-services)**.

Full list + exact commands: **[SELF_HOSTING.md → Secrets you must change](./SELF_HOSTING.md#secrets-you-must-change)**.

> 💡 For a quick **private test on an IP** you can keep the demo secrets for now and just set the
> address — but change them before the instance is public (changing secrets after the first start
> needs a fresh install).

Save with `Ctrl+O`, Enter, `Ctrl+X`, then:

```bash
# 4. Build and start (detached)
docker compose up --build -d
```

The first build takes a few minutes. When it finishes, confirm everything came up:

```bash
docker compose ps      # every container should read "healthy" or "running"
```

### Open your instance

- **The Sqemes app** is on **port 3000** — `http://<your-server>:3000`, or your domain behind a
  proxy. Open it and **sign up**: the first account creates your workspace. Then add an AI provider
  key under **Settings → Integrations** (bring-your-own-key — OpenAI, Anthropic, Gemini, Mistral, …).
- **Port 8000 is the Supabase dashboard (Studio), *not* the app.** If you open it you'll get a
  "Sign in" box — that's the admin dashboard (login = `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`
  from your `.env`). You don't need it for normal use.

Full instructions — a bring-your-own-Supabase alternative, TLS/reverse-proxy setup, and connecting
the Chrome extension — are in **[SELF_HOSTING.md](./SELF_HOSTING.md)**.

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
