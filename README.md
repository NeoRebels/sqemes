# Sqemes

**Open-source, self-hostable prompt-template management and distribution.**

Sqemes is a template management platform: build, organise, and version reusable
**templates** — prompts, assistants, and skills (one `Template` model, distinguished by
`kind`) — and use them wherever you work, through three distribution channels:

- **Chrome extension** — insert templates and AI-enhance prompts directly inside ChatGPT,
  Claude, Gemini, and other AI chats (plus any site you add).
- **In-app Chat** — run your templates against your configured models.
- **MCP server** — expose your templates to any MCP-compatible AI client.

This repository is the **open core**: the full app + backend you can run on your own
infrastructure. Sqemes Cloud adds hosted convenience and a few proprietary pieces — none of
them are required to self-host.

## Quickstart (Docker, one command)

The bundled stack stands up a whole instance — the app plus a self-hosted Supabase
(Postgres, Auth, Storage, PostgREST, Realtime, edge functions) — no separate Supabase
project needed:

```bash
cd selfhost
cp .env.example .env          # then edit the secrets (see the file's header)
docker compose up --build     # add -d to run detached
```

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
