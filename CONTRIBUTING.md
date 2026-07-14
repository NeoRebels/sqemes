# Contributing to Sqemes

Thanks for helping improve Sqemes — the open-core, self-hostable codebase.

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

## Issues

Use the issue templates for bugs and feature requests. For **security** issues, do **not**
open a public issue — see [SECURITY.md](./SECURITY.md).
