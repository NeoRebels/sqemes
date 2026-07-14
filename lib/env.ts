// Build-time environment flags shared across the app.

// True when built for a self-hosted instance (VITE_SELF_HOSTED=true). Self-host has no
// subscription model and no configured OAuth providers, so a few UI paths differ. Cloud
// builds never set the flag. Mirrors the check in lib/subscription.ts.
export const IS_SELF_HOSTED = import.meta.env.VITE_SELF_HOSTED === 'true';
