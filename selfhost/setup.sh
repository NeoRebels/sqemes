#!/bin/sh
# SQEM-128 — interactive first-time setup for self-hosted Sqemes.
#
# Run it once, on its own (so the prompts work), then start the stack:
#   bash setup.sh
#   docker compose up --build -d
#
# It (1) creates .env, (2) generates strong secrets + a valid JWT trio, and (3) ASKS how you'll
# reach the instance and writes SUPABASE_PUBLIC_URL / SITE_URL / API_EXTERNAL_URL (and wires the
# right proxy) for you.
#
# Non-interactive forms:
#   bash setup.sh https://sqemes.example.com             # domain via the built-in Caddy (HTTPS)
#   bash setup.sh https://sqemes.example.com --traefik   # domain via your existing Traefik (labels)
#   bash setup.sh https://sqemes.example.com --proxy     # domain via another proxy (you route it)
#   bash setup.sh http://203.0.113.10:8000               # server IP over HTTP (quick test)
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
[ -f .env ] || cp .env.example .env

set_var() { sed -i "s#^$1=.*#$1=$2#" .env; }
FILES_BASE="docker-compose.yml:docker-compose.sqemes.yml"

# 1) secrets
sh generate-secrets.sh

# 2) address
MODE=""; DOMAIN=""; IP=""
if [ "$#" -ge 1 ]; then
  case "$1" in
    https://*) DOMAIN="${1#https://}"; DOMAIN="${DOMAIN%%/*}"
               case "${2:-}" in --traefik) MODE=traefik ;; --proxy) MODE=proxy ;; *) MODE=caddy ;; esac ;;
    http://*)  MODE=ip; IP="${1#http://}"; IP="${IP%%:*}" ;;
    *) echo "Address must start with http:// or https://" >&2; exit 1 ;;
  esac
else
  printf '\n=== How will you reach this instance? ===\n'
  printf '  1) A domain over HTTPS with the built-in proxy (Caddy) — needs ports 80/443 FREE\n'
  printf '  2) A domain behind your existing Traefik (Docker provider) — auto-routed\n'
  printf '  3) A domain behind another reverse proxy (nginx/…) — you route it yourself\n'
  printf "  4) This server's IP over HTTP  (quick test only)\n"
  printf 'Enter 1, 2, 3 or 4: '
  read -r choice
  case "$choice" in
    1) MODE=caddy;   printf 'Domain (e.g. sqemes.example.com): '; read -r DOMAIN ;;
    2) MODE=traefik; printf 'Domain (e.g. sqemes.example.com): '; read -r DOMAIN ;;
    3) MODE=proxy;   printf 'Domain (e.g. sqemes.example.com): '; read -r DOMAIN ;;
    *) MODE=ip;      printf 'Server public IP: ';                 read -r IP ;;
  esac
fi

case "$MODE" in
  caddy)
    [ -n "$DOMAIN" ] || { echo "No domain given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "https://$DOMAIN"; set_var SITE_URL "https://$DOMAIN"
    set_var API_EXTERNAL_URL "https://$DOMAIN/auth/v1"; set_var PROXY_DOMAIN "$DOMAIN"
    set_var COMPOSE_FILE "$FILES_BASE:docker-compose.caddy.yml"
    printf '\n[setup] Configured https://%s with the built-in Caddy proxy (automatic HTTPS).\n' "$DOMAIN"
    printf '[setup] Ensure DNS for %s points at this server.\n' "$DOMAIN"
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ':80 '; then
      printf '[setup] ⚠ Port 80 is ALREADY IN USE — Caddy needs it. If you run Traefik/nginx,\n'
      printf '[setup]   re-run and choose option 2 or 3 instead.\n'
    fi
    ;;
  traefik)
    [ -n "$DOMAIN" ] || { echo "No domain given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "https://$DOMAIN"; set_var SITE_URL "https://$DOMAIN"
    set_var API_EXTERNAL_URL "https://$DOMAIN/auth/v1"; set_var PROXY_DOMAIN "$DOMAIN"
    set_var COMPOSE_FILE "$FILES_BASE:docker-compose.traefik.yml"
    printf '\n[setup] Configured https://%s via your Traefik (Docker labels) — it auto-routes on up.\n' "$DOMAIN"
    printf '[setup] Defaults: entrypoint=websecure, certresolver=letsencrypt.\n'
    printf '[setup] If yours differ, set TRAEFIK_ENTRYPOINT / TRAEFIK_CERTRESOLVER in .env.\n'
    printf '[setup] DNS for %s must point at this server.\n' "$DOMAIN"
    ;;
  proxy)
    [ -n "$DOMAIN" ] || { echo "No domain given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "https://$DOMAIN"; set_var SITE_URL "https://$DOMAIN"
    set_var API_EXTERNAL_URL "https://$DOMAIN/auth/v1"; set_var PROXY_DOMAIN "$DOMAIN"
    set_var COMPOSE_FILE "$FILES_BASE"
    printf '\n[setup] Configured https://%s WITHOUT a bundled proxy.\n' "$DOMAIN"
    printf '[setup] The stack publishes: app :3000, Kong :8000, api-sidecar :8787.\n'
    printf '[setup] Route your proxy at these — table in SELF_HOSTING.md -> Behind an existing reverse proxy.\n'
    ;;
  ip)
    [ -n "$IP" ] || { echo "No IP given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "http://$IP:8000"; set_var SITE_URL "http://$IP:3000"
    set_var API_EXTERNAL_URL "http://$IP:8000/auth/v1"; set_var COMPOSE_FILE "$FILES_BASE"
    printf '\n[setup] Configured for http://%s (test mode — app on port 3000, no HTTPS).\n' "$IP"
    ;;
esac

printf '\n[setup] Done. Now start it:\n    docker compose up --build -d\n'
