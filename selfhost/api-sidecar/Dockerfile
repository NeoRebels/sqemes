# Sqemes self-host api sidecar — serves the repo's /api handlers (SQEM-116 increment 2).
# Build context is the REPO ROOT (see docker-compose.sqemes.yml → api-sidecar.build.context: ..).
# Zero npm dependencies — just Node + the handler files.

FROM node:22-alpine
WORKDIR /app

# package.json only sets "type": "module" so the ESM handlers import cleanly.
COPY selfhost/api-sidecar/package.json ./
COPY selfhost/api-sidecar/server.js ./
COPY api ./api

EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:8787/.well-known/sqemes-extension-config" || exit 1
CMD ["node", "server.js"]
