/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SENTRY_DSN?: string; // SQEM-114 — optional; Sentry stays disabled when unset
  readonly VITE_SELF_HOSTED?: string; // SQEM-056 — 'true' on self-host: disables the subscription gate
  readonly VITE_APP_VERSION: string; // SQEM-118 — app version, inlined from package.json at build
  readonly VITE_UPDATE_CHECK_URL?: string; // SQEM-118 — self-host: releases API endpoint (empty ⇒ no auto-check)
  readonly VITE_UPDATE_DOCS_URL?: string; // SQEM-118 — self-host: "how to update" docs/wiki URL
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
