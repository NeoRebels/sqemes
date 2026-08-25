# Contributing to Sqemes

Thanks for helping improve Sqemes — the open-core, self-hostable codebase.

## Read this first: how a change actually lands

**This repository is generated.** It is a curated snapshot, exported from the private repository
where Sqemes is developed. Every release rebuilds it wholesale — the export wipes the tree and
writes it out again from upstream.

That has one consequence worth knowing before you spend an evening on a patch:

> **A pull request merged *here* would be erased by the next release.** Not rejected — overwritten,
> silently, because the export does not know it happened.

So we do not merge into this repository. Your PR is the **proposal**; the change lands upstream and
comes back to you in the next release:

```
1.  You open a PR here                    ← this is the right thing to do
2.  We review it and discuss it here      ← in the open, on your PR
3.  If we take it, we port the change upstream, with your name on it
4.  It returns in the next release
```

**Nothing is lost by this.** It means the review happens where you can see it, and the merge happens
where it survives. We will tell you on the PR which release carries your change.

**Why it is built this way:** the hosted product and the self-hostable one are the same codebase,
with a handful of hosted-only paths pruned at export. One source, one place where a change is made,
no two versions drifting apart. The cost is this indirection, and we would rather explain it than
let you discover it.

**What this means in practice**

- **Bug reports and small fixes** — perfect, open a PR or an issue.
- **Anything large or architectural** — open an **issue first**. Not bureaucracy: the upstream repo
  has product constraints that are invisible from here (see the guardrails in the README), and it
  would be unkind to let you build something we cannot take.
- **Do not** push directly to `main`, even if you have access. The next export overwrites it.

### What we cannot take, whoever sends it

Saying this plainly is the point of this section. The alternative is that somebody spends two
weekends on a change we were never going to merge, and finds out at the end — which is a worse
outcome than an unfriendly-looking list.

| Area | Why |
|---|---|
| **Authentication, roles, and row-level security** | A subtle mistake here exposes one customer's workspace to another and is invisible in review. It stays in-house, and no amount of test coverage changes that. |
| **Anything touching provider API keys** | They are stored encrypted and belong to the customer. The blast radius of getting this wrong is somebody else's OpenAI bill and somebody else's data. |
| **The MCP server** | It is the interface a customer's AI agent talks to. Its tool surface is a product decision with a security boundary attached. |
| **The marketplace review path** | It decides what gets distributed to everybody else, including skills that carry executable files. |
| **Billing, plans, credits** | Cloud-only, and not exercisable from this repository at all. |

**None of this means the code is off-limits to read.** It is all here, and understanding it is
welcome — a well-argued issue that says "this looks wrong to me, and here is why" is more valuable
to us than a patch, in exactly these areas.

**Everywhere else, the usual applies:** small fixes are welcome directly, anything larger deserves an
issue first — and that is a request for a conversation, not a form to fill in.

## Local development

```bash
npm install
```

- **Frontend:** React + TypeScript + Vite.
- **Backend:** Supabase — migrations in `supabase/migrations`, edge functions in
  `supabase/functions`.
- **Local full stack** (isolated local Supabase + the app): see
  [docs/LOCAL_DOCKER.md](./docs/LOCAL_DOCKER.md) and the `npm run local:*` scripts.
- **Self-host bundle:** `selfhost/` (Docker Compose) — see
  [SELF_HOSTING.md](./SELF_HOSTING.md).

## Before you open a PR

```bash
npm run lint     # ESLint — must pass (warnings are OK, errors fail CI)
npm test         # Vitest unit tests
npm run build    # production build must succeed
```

## Pull requests

- Keep PRs focused; describe the change and how you tested it.
- Match the existing style — Tailwind utility classes, no UI component libraries, native
  HTML5 drag-and-drop.
- Add or adjust tests under `tests/` where it makes sense.
- **You will be asked to sign a [CLA](./CLA.md) on your first pull request.** A bot posts the
  sentence to reply with; that reply is the signature, and it covers everything you contribute
  afterwards. The reason it exists is worth a sentence: Sqemes Cloud runs from this same codebase, so
  we need your permission to ship your work there too — and we would rather ask than assume. You keep
  your copyright; it is a licence, not an assignment. Contributions are licensed under
  **AGPL-3.0**, as is the rest of this repository from v1.10.0 onward.
- Rather not sign? That is a legitimate position — **open an issue instead.** A well-described
  problem is worth as much as a patch and raises no licensing question at all.
- Remember the flow above: we will not press "Merge" on your PR — we port it upstream and tell you
  which release carries it. If that has not happened after a release, say so on the PR.

## Issues

Use the issue templates for bugs and feature requests. For **security** issues, do **not**
open a public issue — see [SECURITY.md](./SECURITY.md).
