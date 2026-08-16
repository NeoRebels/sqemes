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

Your instance also reads the **community marketplace** (browse, vote, copy a published template —
no setup needed) and can attach **connectors** for external tools such as Notion, Shopify and
Outlook. Both are covered in [SELF_HOSTING.md](./SELF_HOSTING.md).

This repository is the **open core**: the full app + backend you can run on your own
infrastructure. Sqemes Cloud adds hosted convenience and a few proprietary pieces — none of
them are required to self-host.

## Quickstart — one command

On a fresh Linux VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/NeoRebels/sqemes/main/install.sh | sh
```

That's it. The installer sets up Docker if needed, generates strong secrets, configures HTTPS, starts
the whole stack (the app + a self-hosted Supabase), and **asks only for your domain**. It even detects
your setup: a fresh box uses the built-in HTTPS proxy, an existing **Traefik** is auto-wired, and
pressing Enter with no domain runs a quick **IP-only test**.

> Prefer to read it first? `curl -fsSLO https://raw.githubusercontent.com/NeoRebels/sqemes/main/install.sh`,
> look it over, then `sh install.sh`.

**Before you run it:**
- **~4 GB RAM** (the stack is ~15 containers).
- **For HTTPS on a domain:** point the domain at the server first — an **A record** for your
  (sub)domain → the server's public IP. Check with `dig +short sqemes.example.com` (it should print
  the server IP). No domain? Just press Enter at the prompt for the IP-only test.

**When it finishes:** open your domain (or `http://<server-ip>:3000` for the IP test) and **sign up** —
the first account creates your workspace. Then add an AI provider key under **Settings → Integrations**
(bring-your-own-key — OpenAI, Anthropic, Gemini, Mistral, …). *(Port 8000 is the Supabase admin
dashboard, not the app.)*

Prefer to install by hand, run behind nginx or your own Supabase, or view/rotate secrets and update
later? It's all in **[SELF_HOSTING.md](./SELF_HOSTING.md)**.

## Use the Chrome extension with your instance

Install the extension from the **[Chrome Web Store](https://chromewebstore.google.com/detail/sqemes-%E2%80%93-prompt-templates/laaiobhchfmabhembnkpkhjfmnkbmbai)**.
The published extension can point at your self-hosted instance at runtime — no rebuild. In its
options → **Instance**, enter your instance URL → **Check** → **Grant access & connect**. See
[SELF_HOSTING.md → Chrome extension](./SELF_HOSTING.md#chrome-extension-self-host).

## Tech

React + TypeScript + Vite frontend · Supabase (Postgres / Auth / Storage / Realtime / Edge
Functions) backend · Docker for self-hosting.

## Contributing

**Contributions are welcome — and there is one thing to know before you spend an evening on one.**

This repository is **generated**. It is a curated snapshot exported from the private repository where
Sqemes is developed, and every release rebuilds it wholesale. So a pull request merged *here* would
be erased by the next release — not rejected, overwritten, silently.

We therefore do not merge into this repository. **Your PR is the proposal:**

```
1.  You open a PR here                 ← this is the right thing to do
2.  We review it in the open, on your PR
3.  If we take it, we port it upstream, with your name on it
4.  It comes back in the next release, and we tell you which one
```

Nothing is lost by this: the review happens where you can see it, and the merge happens where it
survives.

- **Bug reports and small fixes** — perfect, open a PR or an issue.
- **Anything large** — open an **issue first**. The upstream repo has product constraints that are
  invisible from here, and it would be unkind to let you build something we cannot take.
- **First PR?** A bot will ask you to sign the [CLA](./CLA.md) — one reply, once, about fifteen
  seconds. You keep your copyright. [CONTRIBUTING.md](./CONTRIBUTING.md) explains why we ask.
- **Rather not sign?** Then open an issue instead. A well-described problem is worth as much as a
  patch and raises no licensing question at all.

## Security

- **[SECURITY.md](./SECURITY.md)** — report a vulnerability privately. Please do **not** open a
  public issue for one.
- **[Code of Conduct](./CODE_OF_CONDUCT.md)**.

## License

**[GNU Affero General Public License v3](./LICENSE)** — from **v1.10.0** onward.

```
up to and including v1.9.5    Apache-2.0    permanently
from v1.10.0                  AGPL-3.0
```

**Self-hosting is unaffected.** Run it, modify it, use it for client work — the AGPL asks nothing of
you until you *offer it to others as a service*. If you do that, you have to give those users the
source of what you are running, including your changes. That is the whole difference, and it is
deliberate: it is what keeps someone from taking this codebase closed and selling it back.

**The change is not retroactive**, and could not be — the Apache-2.0 grant is perpetual and
irrevocable, so every release up to v1.9.5 stays available under Apache-2.0 to anyone who has it.
Those releases have not been removed and will not be.

Bundled and depended-upon third-party components keep their own licenses, unaffected — the
self-hosted Supabase stack under `selfhost/` among them. See [NOTICE](./NOTICE).
