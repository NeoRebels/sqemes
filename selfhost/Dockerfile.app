# Production build of the Sqemes SPA for self-hosting.
# Build context is the REPO ROOT (see docker-compose.sqemes.yml → app.build.context: ..).
#
# Vite inlines VITE_*-prefixed variables at build time, so the Supabase URL/key and the
# self-host flag are passed as build args → env, then baked into the static bundle. A
# self-hoster builds their own image (`docker compose up --build`), so per-instance values
# are compiled in from their .env — no separate published image needed.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Vite reads VITE_-prefixed vars from the environment at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SELF_HOSTED=true
ARG VITE_UPDATE_CHECK_URL=
ARG VITE_UPDATE_DOCS_URL=
# NOTE: do NOT set NODE_ENV=production here — it makes `npm ci` skip devDependencies,
# and the build toolchain (vite, typescript) lives in devDependencies. `vite build`
# still emits a production bundle regardless of NODE_ENV.
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SELF_HOSTED=$VITE_SELF_HOSTED \
    VITE_UPDATE_CHECK_URL=$VITE_UPDATE_CHECK_URL \
    VITE_UPDATE_DOCS_URL=$VITE_UPDATE_DOCS_URL

COPY package*.json .npmrc ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# Serve the static bundle with nginx (SPA fallback to index.html).
FROM nginx:1.27-alpine
COPY selfhost/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# SQEM-126 — regenerate /config.js from runtime env on container start (nginx runs every
# /docker-entrypoint.d/*.sh before booting). Lets the instance URL change with a restart, no rebuild.
COPY selfhost/docker-entrypoint.d/40-sqemes-config.sh /docker-entrypoint.d/40-sqemes-config.sh
RUN chmod +x /docker-entrypoint.d/40-sqemes-config.sh
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
