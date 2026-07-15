#!/bin/sh
# SQEM-127 — generate strong, unique secrets for a fresh self-host install.
#
# Run once, after `cp .env.example .env` and BEFORE the first `docker compose up`:
#   bash generate-secrets.sh
#
# It replaces the public demo values in .env with random secrets and a correctly-signed
# JWT trio (JWT_SECRET + matching ANON_KEY/SERVICE_ROLE_KEY). Only needs `openssl`.
# Idempotent: if the secrets were already generated (JWT_SECRET is no longer the demo
# default), it does nothing — so it's safe to re-run and won't clobber your real secrets.
set -eu

ENV_FILE="${1:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "[secrets] No $ENV_FILE found — run 'cp .env.example .env' first." >&2
  exit 1
fi

if ! grep -q '^JWT_SECRET=your-super-secret-jwt-token' "$ENV_FILE"; then
  echo "[secrets] JWT_SECRET is already custom — secrets look generated. Nothing to do."
  echo "[secrets] (To force a regenerate, reset JWT_SECRET to the demo value first.)"
  exit 0
fi

set_var() { sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; }

# --- random secrets (64 hex chars) ---
for V in POSTGRES_PASSWORD SECRET_KEY_BASE API_KEY_ENCRYPTION_KEY DASHBOARD_PASSWORD \
         S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET MINIO_ROOT_PASSWORD; do
  set_var "$V" "$(openssl rand -hex 32)"
done

# --- these two must be exactly 32 characters ---
for V in VAULT_ENC_KEY PG_META_CRYPTO_KEY; do
  set_var "$V" "$(openssl rand -hex 16)"
done

# --- JWT trio: random JWT_SECRET + anon/service_role keys signed with it (HS256) ---
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
mint_jwt() { # $1 = role, $2 = secret
  _now=$(date +%s)
  _exp=$(( _now + 315360000 ))   # ~10 years
  _h=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  _p=$(printf '%s' "{\"role\":\"$1\",\"iss\":\"supabase\",\"iat\":$_now,\"exp\":$_exp}" | b64url)
  _s=$(printf '%s' "$_h.$_p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$_h" "$_p" "$_s"
}

JWT_SECRET_VALUE="$(openssl rand -hex 32)"
set_var JWT_SECRET "$JWT_SECRET_VALUE"
set_var ANON_KEY "$(mint_jwt anon "$JWT_SECRET_VALUE")"
set_var SERVICE_ROLE_KEY "$(mint_jwt service_role "$JWT_SECRET_VALUE")"

echo "[secrets] ✅ Generated strong secrets + JWT keys in $ENV_FILE."
echo "[secrets]    Supabase dashboard login: see  grep -E '^DASHBOARD_' $ENV_FILE"
