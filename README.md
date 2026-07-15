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

# 3. Create your config file, then edit it
cp .env.example .env
nano .env      # an editor opens — save with Ctrl+O then Enter, exit with Ctrl+X
               # (or open .env in any editor you prefer)

# 4. Build and start (detached)
docker compose up --build -d
```

The first build takes a few minutes. When it finishes, confirm everything came up:

```bash
docker compose ps      # every container should read "healthy" or "running"
```

### Before real use, set two things in `.env`

1. **Secrets** — `.env` ships with public **demo** keys so it boots on the first try; they are **not
   safe** for an internet-facing instance (anyone could mint admin tokens). Regenerate them:
   **[SELF_HOSTING.md → Secrets you must change](./SELF_HOSTING.md#secrets-you-must-change)**.
2. **Your address** — point these at how you'll actually reach the instance (a domain over HTTPS is
   strongly recommended). Set them **before** step 4 on first run; to change them later, just edit
   `.env` and `docker compose up -d` (a restart — **no rebuild**):
   ```
   SUPABASE_PUBLIC_URL=https://sqemes.example.com
   SITE_URL=https://sqemes.example.com
   API_EXTERNAL_URL=https://sqemes.example.com/auth/v1
   ```
   For a domain + automatic HTTPS, put a reverse proxy in front — the bundled Caddy overlay does it
   on a fresh box, or slot it behind your existing Traefik/nginx:
   **[SELF_HOSTING.md → Behind an existing reverse proxy](./SELF_HOSTING.md#behind-an-existing-reverse-proxy-traefik-nginx)**.

### Open your instance

- **The Sqemes app** is on **port 3000** — `http://<your-server>:3000`, or your domain behind a
  proxy. Open it and **sign up**: the first account creates your workspace. Then add an AI provider
  key under **Settings → Integrations** (bring-your-own-key — OpenAI, Anthropic, Gemini, Mistral, …).
- **Port 8000 is the Supabase dashboard (Studio), *not* the app.** If you open it you'll get a
  "Sign in" box — that's the admin dashboard (login = `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`
  from your `.env`). You don't need it for normal use.

> ℹ️ With the **default** `.env` the URLs are `localhost`, so the app only works *from the server
> itself*. To reach it from your own browser, set the three URLs above to your domain (or the
> server's IP for a quick test) and `docker compose up -d` (restart — no rebuild).

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
