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
4.  It returns in the next release — and we check whether it belongs in
    the hosted product too
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
- By contributing, you agree your contributions are licensed under **Apache-2.0**.
- Remember the flow above: we will not press "Merge" on your PR — we port it upstream and tell you
  which release carries it. If that has not happened after a release, say so on the PR.

## Issues

Use the issue templates for bugs and feature requests. For **security** issues, do **not**
open a public issue — see [SECURITY.md](./SECURITY.md).
