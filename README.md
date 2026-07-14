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

## Quickstart (Docker, one command)

The bundled stack stands up a whole instance — the app plus a self-hosted Supabase
(Postgres, Auth, Storage, PostgREST, Realtime, edge functions) — no separate Supabase
project needed:

```bash
cd selfhost
cp .env.example .env
docker compose up --build     # add -d to run detached
```

> ⚠️ **Before exposing this to the internet, change the secrets in `.env`.** It ships with public
> **demo** keys so it boots on the first try — leaving them is insecure (the demo JWT keys are
> well-known, so anyone could mint admin tokens). See
> **[SELF_HOSTING.md → Secrets you must change](./SELF_HOSTING.md#secrets-you-must-change)**.

Open the app, sign up, and add a provider key (bring-your-own-key). Full instructions — a
bring-your-own-Supabase alternative, TLS/reverse-proxy setup, and connecting the Chrome
extension — are in **[SELF_HOSTING.md](./SELF_HOSTING.md)**.

> **Minimum:** ~4 GB RAM (the full Supabase stack is ~10 containers). Serve it over HTTPS so
> the extension, OAuth, and MCP work.

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
