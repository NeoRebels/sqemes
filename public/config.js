// SQEM-126 — runtime instance config.
// On a self-hosted deployment, the app container regenerates this file from environment
// variables at startup (see selfhost/docker-entrypoint.d/40-sqemes-config.sh), so operators
// can change the instance URL with a restart — no rebuild. On Cloud (and any plain build)
// this stays an empty placeholder and the app falls back to its build-time VITE_* values.
window.__SQEMES_CONFIG__ = window.__SQEMES_CONFIG__ || {};
