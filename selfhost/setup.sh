#!/bin/sh
# SQEM-128 — interactive first-time setup for self-hosted Sqemes.
#
# Run it once, on its own (so the prompts work), then start the stack:
#   bash setup.sh
#   docker compose up --build -d
#
# It (1) creates .env, (2) generates strong secrets + a valid JWT trio, and (3) ASKS how you'll
# reach the instance and writes SUPABASE_PUBLIC_URL / SITE_URL / API_EXTERNAL_URL for you — so you
# never have to hand-edit URLs. You can also pass the address non-interactively:
#   bash setup.sh https://sqemes.example.com     # domain (HTTPS via bundled Caddy)
#   bash setup.sh http://203.0.113.10:8000       # server IP (HTTP test)
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
[ -f .env ] || cp .env.example .env

set_var() { sed -i "s#^$1=.*#$1=$2#" .env; }

# 1) secrets
sh generate-secrets.sh

# 2) address — from an argument, or ask
MODE=""; DOMAIN=""; IP=""
if [ "$#" -ge 1 ]; then
  case "$1" in
    https://*) MODE=domain; DOMAIN="${1#https://}"; DOMAIN="${DOMAIN%%/*}" ;;
    http://*)  MODE=ip;     IP="${1#http://}";      IP="${IP%%:*}" ;;
    *) echo "Address must start with http:// or https://" >&2; exit 1 ;;
  esac
else
  printf '\n=== How will you reach this instance? ===\n'
  printf '  1) A domain over HTTPS  (recommended for production; DNS must point at this server)\n'
  printf "  2) This server's IP over HTTP  (quick test only)\n"
  printf 'Enter 1 or 2: '
  read -r choice
  if [ "$choice" = "1" ]; then
    MODE=domain; printf 'Domain (e.g. sqemes.example.com): '; read -r DOMAIN
  else
    MODE=ip;     printf 'Server public IP: ';                 read -r IP
  fi
fi

if [ "$MODE" = "domain" ]; then
  [ -n "$DOMAIN" ] || { echo "No domain given." >&2; exit 1; }
  set_var SUPABASE_PUBLIC_URL "https://$DOMAIN"
  set_var SITE_URL            "https://$DOMAIN"
  set_var API_EXTERNAL_URL    "https://$DOMAIN/auth/v1"
  set_var PROXY_DOMAIN        "$DOMAIN"
  set_var COMPOSE_FILE        "docker-compose.yml:docker-compose.sqemes.yml:docker-compose.caddy.yml"
  printf '\n[setup] Configured for https://%s — the bundled Caddy proxy fetches HTTPS automatically.\n' "$DOMAIN"
  printf '[setup] Make sure DNS for %s points at this server and ports 80/443 are free.\n' "$DOMAIN"
  printf '[setup] (Already run Traefik/nginx? See SELF_HOSTING.md -> Behind an existing reverse proxy.)\n'
else
  [ -n "$IP" ] || { echo "No IP given." >&2; exit 1; }
  set_var SUPABASE_PUBLIC_URL "http://$IP:8000"
  set_var SITE_URL            "http://$IP:3000"
  set_var API_EXTERNAL_URL    "http://$IP:8000/auth/v1"
  printf '\n[setup] Configured for http://%s (test mode — the app will be on port 3000, no HTTPS).\n' "$IP"
fi

printf '\n[setup] Done. Now start it:\n    docker compose up --build -d\n'
