# Local Full Stack Setup

Use this setup to run Sqemes locally without touching hosted Supabase, staging, or production resources.

The local stack starts:

- Supabase PostgreSQL/Auth/Storage/Realtime/Edge Runtime via the Supabase CLI and Docker.
- The Sqemes Vite app via this repo's `docker-compose.yml`.
- A generated `.env.local` that points the browser app at the local Supabase API.

## Prerequisites

- Docker Desktop or Docker Engine with Docker Compose v2.
- Node dependencies installed:

```bash
npm ci
```

The Supabase CLI is installed as a project dev dependency. Do not use `supabase link`, `supabase db push`, or production Supabase secrets for this local setup.

## Start Everything Locally

For a clean first local run:

```bash
npm run local:fresh
```

For normal subsequent runs that keep local database data:

```bash
npm run local:up
```

Open:

```text
http://localhost:3000
```

Useful local service URLs:

```text
Supabase API:    http://127.0.0.1:54321
Supabase Studio: http://127.0.0.1:54323
Inbucket email:  http://127.0.0.1:54324
Postgres:        postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`npm run local:fresh` starts Supabase, resets the local database from `supabase/migrations/` and `supabase/seed.sql`, writes local Supabase values to `.env.local`, and starts the Docker dev app.

If `.env.local` already points at a hosted Supabase URL, the script backs it up before writing local values.

The local script also creates a local-only E2E user:

```text
Email:    test@example.com
Password: testpassword123
```

Override those credentials for a run with `TEST_EMAIL` and `TEST_PASSWORD`. The script refuses to seed users unless the Supabase URL is local.

## Local Environment Safety

The local script writes only frontend-safe local values:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key from supabase status>
```

Do not put service-role keys, database passwords, production deployment secrets, Stripe live keys, Resend production keys, or hosted Supabase project values in `.env.local` for local runs.

The script refuses to start the app if `.env.local` points to a non-local Supabase URL.

## Database Reset

Reset only the local database:

```bash
npm run local:reset
```

This runs `supabase db reset --local`. It does not push to, pull from, or mutate any linked or hosted Supabase project.

After reset, the script re-seeds the local E2E user and workspace.

## Dev Server

The app service can still be run directly when Supabase is already up:

```bash
docker compose up --build app
```

The dev service mounts the repository into the container and keeps `node_modules` in a Docker volume, so source edits on the host reload the app without installing dependencies on the host.

## Production-Style Local Preview

Run the full local stack with a container that builds the app and then serves the built `dist/` output with Vite preview:

```bash
npm run local:up:preview
```

Or run only the preview app container when local Supabase is already up:

```bash
docker compose --profile preview up --build app-preview
```

Open:

```text
http://localhost:3000
```

This is the closest local Docker check to the existing production build path. It does not deploy and does not use production secrets.

## Edge Functions And External Providers

Local Supabase serves Edge Functions at:

```text
http://127.0.0.1:54321/functions/v1/<function-name>
```

Core app/auth/data flows should use the local Supabase stack. Features that intentionally call external providers, such as Stripe, Resend, or model APIs, need local/test credentials and should never use production keys during local runs.

## Useful Commands

Show local status:

```bash
npm run local:status
```

Follow app logs:

```bash
npm run local:logs
```

Stop app containers and local Supabase while keeping local DB data:

```bash
npm run local:stop
```

Stop everything and remove local app/Supabase volumes:

```bash
npm run local:destroy
```

Use a different host port:

```bash
SQEMES_PORT=3001 docker compose up --build app
```

Run tests from the host against the Docker app:

```bash
npm run test:e2e
```

Playwright is configured to use `http://localhost:3000`.
