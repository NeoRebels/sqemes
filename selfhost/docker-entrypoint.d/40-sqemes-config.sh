#!/bin/sh
# SQEM-126 — write the SPA's runtime instance config (window.__SQEMES_CONFIG__) from env at
# container start. The nginx image runs every /docker-entrypoint.d/*.sh before starting nginx,
# so this regenerates /config.js on each `docker compose up` — letting an operator change the
# instance URL by editing .env and restarting, with no image rebuild.
set -e

cat > /usr/share/nginx/html/config.js <<EOF
window.__SQEMES_CONFIG__ = {
  supabaseUrl: "${SUPABASE_PUBLIC_URL:-}",
  supabaseAnonKey: "${ANON_KEY:-}",
  updateCheckUrl: "${VITE_UPDATE_CHECK_URL:-}",
  updateDocsUrl: "${VITE_UPDATE_DOCS_URL:-}"
};
EOF

echo "[sqemes] wrote /config.js (supabaseUrl=${SUPABASE_PUBLIC_URL:-<unset>})"
