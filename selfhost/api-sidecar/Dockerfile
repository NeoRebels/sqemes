# Sqemes self-host api sidecar — serves the repo's /api handlers (SQEM-116 increment 2).
# Build context is the REPO ROOT (see docker-compose.sqemes.yml → api-sidecar.build.context: ..).
#
# SQEM-399 — two stages, because `api/` is not all JavaScript any more. `api/extension-config.ts`
# (SQEM-309) is TypeScript and imports `../constants.js`, which is `constants.ts`. Node resolves
# neither a `.ts` handler behind the `.js` specifier `server.js` uses, nor the import inside it — so
# the single-stage file this used to be (copy `api/` raw, run it) produced an image whose process
# died on its first import and never listened. ⛔ That shipped in every release from v1.11.4 to
# v1.11.13 and nothing noticed: the container was "unhealthy" in a stack nobody was running yet.
#
# The build stage turns every `api/*.ts` into a self-contained `api/*.js` with esbuild, which follows
# TypeScript's `.js` → `.ts` import convention and inlines what the handler reaches (today: the model
# list from `constants.ts`). Plain `.js` handlers are copied unchanged. The runtime stage is what it
# always was — Node plus handler files, no npm dependency, `server.js` untouched.
#
# ⚠️ esbuild is pinned. `npx` fetches it at image build (the build already needs the network for the
# base image); an unpinned version would make the image depend on whatever shipped that day.
# `tests/unit/selfhostSidecar.test.ts` pins the shape of this file.
FROM node:22-alpine AS build
WORKDIR /src
COPY api ./api
COPY constants.ts types.ts ./
RUN mkdir -p /out/api \
 && for f in api/*.ts; do \
      [ -e "$f" ] || continue; \
      npx -y esbuild@0.28.2 "$f" --bundle --platform=node --format=esm \
        --outfile="/out/api/$(basename "${f%.ts}").js" || exit 1; \
    done \
 && cp api/*.js /out/api/

FROM node:22-alpine
WORKDIR /app

# package.json only sets "type": "module" so the ESM handlers import cleanly.
COPY selfhost/api-sidecar/package.json ./
COPY selfhost/api-sidecar/server.js ./
COPY --from=build /out/api ./api

EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:8787/.well-known/sqemes-extension-config" || exit 1
CMD ["node", "server.js"]
