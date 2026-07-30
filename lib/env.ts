// Build-time environment flags shared across the app.

// True when built for a self-hosted instance (VITE_SELF_HOSTED=true). Self-host has no
// subscription model and no configured OAuth providers, so a few UI paths differ. Cloud
// builds never set the flag. Mirrors the check in lib/subscription.ts.
export const IS_SELF_HOSTED = import.meta.env.VITE_SELF_HOSTED === 'true';

// SQEM-176/178 — the global community marketplace. Cloud uses its local Supabase (source of truth);
// self-host reads it over the public `marketplace-public` endpoint. Default points at Cloud prod;
// override per instance via VITE_MARKETPLACE_API_URL, or set it empty to disable the marketplace.
export const MARKETPLACE_API_URL = (
  import.meta.env.VITE_MARKETPLACE_API_URL ?? 'https://api.sqemes.com/functions/v1/marketplace-public'
).replace(/\/+$/, '');

// Whether the marketplace is reachable on this instance (Cloud always; self-host unless disabled).
export const MARKETPLACE_ENABLED = !IS_SELF_HOSTED || MARKETPLACE_API_URL !== '';
