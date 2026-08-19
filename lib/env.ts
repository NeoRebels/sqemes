// Build-time environment flags shared across the app.

// True when built for a self-hosted instance (VITE_SELF_HOSTED=true). Self-host has no
// subscription model and no configured OAuth providers, so a few UI paths differ. Cloud
// builds never set the flag. Mirrors the check in lib/subscription.ts.
export const IS_SELF_HOSTED = import.meta.env.VITE_SELF_HOSTED === 'true';

// SQEM-176/178 — the global community marketplace.
//
// ⚠️ **A Cloud deployment reads its OWN marketplace; only self-host reads Cloud production
// (SQEM-258).** The default used to be Cloud prod for everyone, which was invisible while the only
// consumer was the signed-in path — that one goes through `supabase.from('library_templates')` and
// therefore always reads the project the app is pointed at. The moment the **public** listing page
// started using this URL, staging began reading production: a listing that exists on staging, and
// renders fine when signed in, was "not available" to a signed-out visitor. Measured on 2026-08-19.
//
// The consequence was worse than one wrong page. **The feature became unverifiable in the place we
// verify things** — every staging listing is invisible to the public path. An environment that
// cannot check itself is the failure here, not the missing row.
//
// So: derive it from the Supabase project this build talks to. Self-host keeps Cloud prod, because
// there the marketplace genuinely is somebody else's. Override per instance with
// VITE_MARKETPLACE_API_URL, or set it empty to disable the marketplace.
export const CLOUD_PROD_MARKETPLACE = 'https://api.sqemes.com/functions/v1/marketplace-public';

/** Exported and pure so the rule can be pinned by a test — it is what just went wrong. */
export function marketplaceUrlFor(
  { selfHosted, supabaseUrl, override }: { selfHosted: boolean; supabaseUrl?: string; override?: string },
): string {
  const trim = (v: string) => v.trim().replace(/\/+$/, '');
  if (override !== undefined) return trim(override);
  if (selfHosted) return CLOUD_PROD_MARKETPLACE;
  const own = trim(supabaseUrl ?? '');
  // No Supabase URL means the build is broken anyway (`lib/supabase.ts` throws); falling back to
  // Cloud prod keeps a marketplace rather than an empty one.
  return own ? `${own}/functions/v1/marketplace-public` : CLOUD_PROD_MARKETPLACE;
}

export const MARKETPLACE_API_URL = marketplaceUrlFor({
  selfHosted: IS_SELF_HOSTED,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  override: import.meta.env.VITE_MARKETPLACE_API_URL,
});

// Whether the marketplace is reachable on this instance (Cloud always; self-host unless disabled).
export const MARKETPLACE_ENABLED = !IS_SELF_HOSTED || MARKETPLACE_API_URL !== '';
