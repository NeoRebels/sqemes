#!/bin/sh
# Sqemes — one-command self-host installer.
#
#   curl -fsSL https://raw.githubusercontent.com/NeoRebels/sqemes/main/install.sh | sh
#
# Installs Docker (if needed), clones the repo, generates strong secrets, detects how to expose the
# instance (built-in HTTPS proxy / your existing Traefik / IP test), starts it — and asks only for
# your domain. Re-runnable: it updates an existing ./sqemes clone.
set -eu

REPO="https://github.com/NeoRebels/sqemes"
say() { printf '\n\033[1m[sqemes]\033[0m %s\n' "$1"; }

# Read a prompt from the terminal — works even when the script is piped (curl | sh),
# because it reads /dev/tty rather than stdin. Echoes the answer on stdout.
ask() {
  _ans=""
  if [ -e /dev/tty ]; then
    printf '%s' "$1" > /dev/tty
    read -r _ans < /dev/tty || _ans=""
  fi
  printf '%s' "$_ans"
}

# 1. Docker
if command -v docker >/dev/null 2>&1; then
  say "Docker is installed."
else
  say "Installing Docker (official convenience script)..."
  curl -fsSL https://get.docker.com | sh
fi

# 2. Clone (or update)
if [ -d sqemes/.git ]; then
  say "Found ./sqemes — updating it."
  (cd sqemes && git pull --ff-only || true)
else
  say "Cloning $REPO ..."
  git clone "$REPO"
fi
cd sqemes/selfhost

# 3. The only question
DOMAIN=$(ask "Domain for Sqemes (e.g. sqemes.example.com) — or press Enter for an IP-only test: ")

# 4. Detect how to expose it, then configure via setup.sh
if [ -n "$DOMAIN" ]; then
  if docker ps --format '{{.Image}}' 2>/dev/null | grep -qi 'traefik'; then
    say "Detected a running Traefik — routing $DOMAIN through it (Docker labels)."
    sh setup.sh "https://$DOMAIN" --traefik
  elif command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE ':(80|443)[[:space:]]'; then
    say "Ports 80/443 are in use and no Traefik was found."
    say "Configuring $DOMAIN for your own reverse proxy — you'll point it at the stack (SELF_HOSTING.md)."
    sh setup.sh "https://$DOMAIN" --proxy
  else
    say "Using the built-in Caddy proxy for automatic HTTPS on $DOMAIN."
    sh setup.sh "https://$DOMAIN"
  fi
else
  IP=$(curl -fsS https://api.ipify.org 2>/dev/null || true)
  [ -n "$IP" ] || IP=$(ask "Could not detect the server IP — enter it: ")
  say "No domain given — test mode (HTTP) on this server's IP: $IP."
  sh setup.sh "http://$IP:8000"
fi

# 5. Build + start
say "Building and starting — first run pulls images + builds, so give it a few minutes..."
docker compose up --build -d

# 6. Done
SITE=$(grep -E '^SITE_URL=' .env | cut -d= -f2- || true)
say "Done. Open:  ${SITE:-your instance}"
say "Sign up (the first account creates your workspace), then add an AI provider key under"
say "Settings -> Integrations. Secrets, updating, and other setups: see the repo's SELF_HOSTING.md."
