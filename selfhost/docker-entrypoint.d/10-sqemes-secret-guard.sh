#!/bin/sh
# SQEM-216 — refuse to start on the Supabase demo keys.
#
# `selfhost/.env.example` ships with Supabase's publicly documented demo JWTs (`iss:
# supabase-demo`) so the file is readable and the stack boots for a first look. `setup.sh` runs
# `generate-secrets.sh`, which replaces them — but **nothing enforced that path**. Anyone who ran
# `docker compose up` straight from the example file was serving an instance whose anon *and*
# service-role keys are printed in Supabase's own documentation: anybody could read and write the
# whole database.
#
# This runs before 40-sqemes-config.sh (the nginx image executes /docker-entrypoint.d/*.sh in
# order, and its entrypoint uses `set -e`, so a non-zero exit here stops the container).
#
# It checks ANON_KEY because that is what this container actually receives. The demo anon and
# service-role tokens carry `"iss": "supabase-demo"` in their payload; base64 alignment differs
# between the two, hence two markers rather than one.
#
# Not a general "is this key strong" check — it catches exactly one mistake, the one that is easy
# to make and expensive to discover. There is deliberately no override flag: an escape hatch here
# would be used once "just to try it" and then forgotten in production.
#
# Trap worth knowing: this guard keys off ANON_KEY, but generate-secrets.sh keys off JWT_SECRET
# ("already custom → nothing to do"). A .env with a hand-set JWT_SECRET and an untouched ANON_KEY
# therefore fails here while the fix script declines to run — a loop with no exit. That state is
# broken anyway (the trio must be signed together, so logins fail regardless), so the message names
# it explicitly rather than leaving people to rediscover it. Keeping the check on ANON_KEY is
# deliberate: it is the value this container actually receives and hands to browsers.
#
# (`docs/LOCAL_DOCKER.md` is unaffected — local development runs the Supabase CLI stack with keys
# from `supabase status`, not this compose file. It already refuses to start against a non-local
# URL, which is the same idea.)
set -e

DEMO_MARKER_ANON="c3VwYWJhc2UtZGVtby"      # "supabase-demo" as it appears in the demo anon token
DEMO_MARKER_SERVICE="zdXBhYmFzZS1kZW1v"    # ...and in the demo service_role token

case "${ANON_KEY:-}" in
  *"$DEMO_MARKER_ANON"*|*"$DEMO_MARKER_SERVICE"*)
    cat >&2 <<'MSG'

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Sqemes refused to start: this instance is using Supabase's DEMO keys.    │
  └──────────────────────────────────────────────────────────────────────────┘

  ANON_KEY is still the public demo token that ships in .env.example. It is
  printed in Supabase's own documentation, so anyone who finds this instance
  could read and write its entire database.

  ── If you are setting up (no data yet) ──────────────────────────────────

      cd selfhost && sh generate-secrets.sh
      docker compose up -d

  Or just use the installer, which does this for you: ./install.sh

  If that prints "JWT_SECRET is already custom — nothing to do", then your
  JWT_SECRET was changed by hand but ANON_KEY was not. The trio no longer
  matches and logins would fail even without this check. Fix it by resetting
  JWT_SECRET in .env to its .env.example value and running the script again,
  which mints all three together.

  ── If this instance has been running and has data ───────────────────────

  Then generating new secrets is NOT enough. Most secrets are baked into the
  database on its first start, so a new JWT_SECRET will not match the data
  that is already there. This is a rotation:

      1. Back up selfhost/volumes/ first.
      2. docker compose down -v  &&  remove selfhost/volumes/
      3. sh generate-secrets.sh  &&  docker compose up -d
      4. Restore your content into the fresh instance.

  See SELF_HOSTING.md → "Secrets" → "Change / rotate them".

  Uncomfortable, and deliberately so: this instance has been reachable with
  keys anyone can look up. Whatever is in it should be treated as exposed.

MSG
    exit 1
    ;;
esac
