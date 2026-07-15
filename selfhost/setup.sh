#!/bin/sh
# SQEM-128 — interactive first-time setup for self-hosted Sqemes.
#
# Run it once, on its own (so the prompts work), then start the stack:
#   bash setup.sh
#   docker compose up --build -d
#
# It (1) creates .env, (2) generates strong secrets + a valid JWT trio, and (3) ASKS how you'll
# reach the instance and writes SUPABASE_PUBLIC_URL / SITE_URL / API_EXTERNAL_URL for you.
#
# Non-interactive forms:
#   bash setup.sh https://sqemes.example.com            # domain via the built-in Caddy (HTTPS)
#   bash setup.sh https://sqemes.example.com --proxy    # domain, you route your own Traefik/nginx
#   bash setup.sh http://203.0.113.10:8000              # server IP over HTTP (quick test)
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
               if [ "${2:-}" = "--proxy" ]; then MODE=proxy; else MODE=caddy; fi ;;
    http://*)  MODE=ip; IP="${1#http://}"; IP="${IP%%:*}" ;;
    *) echo "Address must start with http:// or https://" >&2; exit 1 ;;
  esac
else
  printf '\n=== How will you reach this instance? ===\n'
  printf '  1) A domain over HTTPS with the built-in proxy (Caddy) — needs ports 80/443 FREE\n'
  printf '  2) A domain, but I already run my own reverse proxy (Traefik/nginx)\n'
  printf "  3) This server's IP over HTTP  (quick test only)\n"
  printf 'Enter 1, 2 or 3: '
  read -r choice
  case "$choice" in
    1) MODE=caddy; printf 'Domain (e.g. sqemes.example.com): '; read -r DOMAIN ;;
    2) MODE=proxy; printf 'Domain (e.g. sqemes.example.com): '; read -r DOMAIN ;;
    *) MODE=ip;    printf 'Server public IP: ';                 read -r IP ;;
  esac
fi

case "$MODE" in
  caddy)
    [ -n "$DOMAIN" ] || { echo "No domain given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "https://$DOMAIN"
    set_var SITE_URL            "https://$DOMAIN"
    set_var API_EXTERNAL_URL    "https://$DOMAIN/auth/v1"
    set_var PROXY_DOMAIN        "$DOMAIN"
    set_var COMPOSE_FILE        "$FILES_BASE:docker-compose.caddy.yml"
    printf '\n[setup] Configured https://%s with the built-in Caddy proxy (automatic HTTPS).\n' "$DOMAIN"
    printf '[setup] Ensure DNS for %s points at this server.\n' "$DOMAIN"
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ':80 '; then
      printf '[setup] ⚠ Port 80 is ALREADY IN USE — Caddy needs it and will fail to start.\n'
      printf '[setup]   Another proxy (Traefik/nginx) is running. Re-run and choose option 2 instead,\n'
      printf '[setup]   or stop that service to free ports 80/443.\n'
    fi
    ;;
  proxy)
    [ -n "$DOMAIN" ] || { echo "No domain given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "https://$DOMAIN"
    set_var SITE_URL            "https://$DOMAIN"
    set_var API_EXTERNAL_URL    "https://$DOMAIN/auth/v1"
    set_var COMPOSE_FILE        "$FILES_BASE"
    printf '\n[setup] Configured https://%s WITHOUT the built-in proxy.\n' "$DOMAIN"
    printf '[setup] The stack publishes: app :3000, Kong :8000, api-sidecar :8787.\n'
    printf '[setup] Point your reverse proxy for %s at these — routing table in\n' "$DOMAIN"
    printf '[setup] SELF_HOSTING.md -> Behind an existing reverse proxy.\n'
    ;;
  ip)
    [ -n "$IP" ] || { echo "No IP given." >&2; exit 1; }
    set_var SUPABASE_PUBLIC_URL "http://$IP:8000"
    set_var SITE_URL            "http://$IP:3000"
    set_var API_EXTERNAL_URL    "http://$IP:8000/auth/v1"
    set_var COMPOSE_FILE        "$FILES_BASE"
    printf '\n[setup] Configured for http://%s (test mode — app on port 3000, no HTTPS).\n' "$IP"
    ;;
esac

printf '\n[setup] Done. Now start it:\n    docker compose up --build -d\n'
