#!/bin/sh
# Sqemes self-host init (SQEM-116, increment 1).
#
# Applies the repo's SQL migrations to the bundled Postgres and ensures the private
# `workspace-files` storage bucket exists. Mirrors `supabase db push`: migrations are
# tracked in supabase_migrations.schema_migrations and applied once, in filename order,
# so re-running this container is safe (already-applied migrations are skipped).
#
# Runs in a postgres:17-alpine container with /migrations (repo's supabase/migrations)
# mounted read-only. Fails loudly (ON_ERROR_STOP) so a bad migration surfaces in logs.
set -eu

HOST="${POSTGRES_HOST:-db}"
PORT="${POSTGRES_PORT:-5432}"
DB="${POSTGRES_DB:-postgres}"
export PGPASSWORD="${POSTGRES_PASSWORD}"

PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc -h ${HOST} -p ${PORT} -U postgres -d ${DB}"

echo "[init] waiting for Postgres at ${HOST}:${PORT} ..."
until pg_isready -h "${HOST}" -p "${PORT}" -U postgres >/dev/null 2>&1; do
  sleep 2
done
echo "[init] Postgres is ready."

# The storage service creates the storage.* tables (storage.buckets/objects) on its
# own startup — independently of our migrations. Several migrations INSERT into
# storage.buckets, so wait for that table to exist before applying anything.
echo "[init] waiting for the storage schema (storage.buckets) ..."
tries=0
until [ "$($PSQL -tAq -c "select to_regclass('storage.buckets') is not null")" = "t" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 90 ]; then
    echo "[init] ERROR: storage.buckets never appeared — is the 'storage' service running/healthy?"
    exit 1
  fi
  sleep 2
done
echo "[init] storage schema is ready."

# Migration bookkeeping (same schema/table the Supabase CLI uses).
$PSQL -q -c "create schema if not exists supabase_migrations;"
$PSQL -q -c "create table if not exists supabase_migrations.schema_migrations (version text primary key, inserted_at timestamptz not null default now());"

applied=0
skipped=0
for f in /migrations/*.sql; do
  [ -e "$f" ] || { echo "[init] no migrations found in /migrations"; break; }
  base="$(basename "$f")"
  version="$(printf '%s' "$base" | sed -E 's/^([0-9]+)_.*/\1/')"
  if [ "$version" = "$base" ]; then
    echo "[init] WARN: cannot parse version from '$base' — using full name as version"
    version="$base"
  fi
  exists="$($PSQL -tAq -c "select 1 from supabase_migrations.schema_migrations where version = '${version}'")"
  if [ "$exists" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "[init] applying ${base} (version ${version}) ..."
  $PSQL -1 -f "$f"
  $PSQL -q -c "insert into supabase_migrations.schema_migrations (version) values ('${version}') on conflict (version) do nothing;"
  applied=$((applied + 1))
done
echo "[init] migrations done — applied ${applied}, skipped ${skipped}."

# Ensure the private workspace-files bucket exists (RLS policies come from the migrations).
echo "[init] ensuring 'workspace-files' storage bucket (private) ..."
$PSQL -q -c "insert into storage.buckets (id, name, public) values ('workspace-files', 'workspace-files', false) on conflict (id) do nothing;"

# PostgREST cached its schema at boot, before these migrations created the app tables.
# Tell it to reload so the REST API exposes them (otherwise every table 404s until restart).
echo "[init] reloading PostgREST schema cache ..."
$PSQL -q -c "NOTIFY pgrst, 'reload schema';"

echo "[init] complete."
echo ""
echo "============================================================"
echo "  ✅ Sqemes setup complete."
echo "  The app is ready once all containers are healthy:"
echo "      docker compose ps"
echo "  Then open your instance (app on port ${SQEMES_APP_PORT:-3000},"
echo "  or your domain behind a reverse proxy) and sign up."
echo "============================================================"
