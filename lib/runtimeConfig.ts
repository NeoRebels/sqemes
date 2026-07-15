// SQEM-126 — runtime instance config injected by the self-host container via /config.js
// (window.__SQEMES_CONFIG__). Empty on Cloud/plain builds, where callers fall back to the
// build-time VITE_* variables. Lets a self-hoster change the instance URL with a restart
// (no rebuild).

export interface RuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  updateCheckUrl?: string;
  updateDocsUrl?: string;
}

export const runtimeConfig: RuntimeConfig =
  (globalThis as { __SQEMES_CONFIG__?: RuntimeConfig }).__SQEMES_CONFIG__ || {};
