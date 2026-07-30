// SQEM-177 (SQEM-176 Phase A) — PUBLIC, unauthenticated marketplace read endpoint for the global
// community marketplace. Lets self-host instances (and anyone) browse + copy the Cloud marketplace
// without a Cloud account.
//
// Security invariants (a bug here = data leak, so they are explicit):
//   • Only `published = true` rows are EVER returned — never pending/rejected/draft.
//   • Strict public column allowlist. NEVER expose workspace_id, created_by, bundle_path (it embeds the
//     workspace id in its path), status, scan_risk, or scan_reasons. `has_bundle` (bool) replaces the path.
//   • The `bundle` action resolves the storage path server-side, only for published listings.
//   • No mutation anywhere in this function.
//   • CORS is open (`*`): it returns only public marketplace data with no credentials, and self-host
//     instances call it from arbitrary domains — the fail-closed getCorsHeaders allowlist can't know them.
//   • Public like stripe-webhook: no apikey/JWT required (deploy uses --no-verify-jwt; verify_jwt=false).
import { createAdminClient } from '../_shared/supabase-admin.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Public column allowlist — do NOT add workspace_id, created_by, bundle_path, status, scan_risk, scan_reasons.
const LIST_COLS =
  'id, kind, title, description, category, tags, variables, steps, system_instruction, brand_config, usage_count, created_at, updated_at, score, vote_count, preview';
const DETAIL_COLS = `${LIST_COLS}, content`;

// Strip bundle_path (leaks the workspace id) and surface only its presence as a boolean.
function toPublicRow(row: Record<string, unknown>) {
  const { bundle_path, ...rest } = row as { bundle_path?: string | null };
  return { ...rest, published: true, has_bundle: !!bundle_path };
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { action, id, listingId } = await req.json().catch(() => ({}));
    const admin = createAdminClient();

    if (action === 'list') {
      const { data, error } = await admin
        .from('library_templates')
        .select(`${LIST_COLS}, bundle_path`)
        .eq('published', true)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ listings: (data || []).map((r) => toPublicRow(r as Record<string, unknown>)) });
    }

    if (action === 'detail') {
      if (!id) return json({ error: 'id required' }, 400);
      const { data, error } = await admin
        .from('library_templates')
        .select(`${DETAIL_COLS}, bundle_path`)
        .eq('id', id)
        .eq('published', true)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: 'Not found' }, 404);
      return json({ listing: toPublicRow(data as Record<string, unknown>) });
    }

    if (action === 'bundle') {
      if (!listingId) return json({ error: 'listingId required' }, 400);
      const { data: row } = await admin
        .from('library_templates')
        .select('id, published, bundle_path')
        .eq('id', listingId)
        .eq('published', true)
        .maybeSingle();
      if (!row || !row.bundle_path) return json({ error: 'Not found' }, 404);
      const { data: signed, error: signErr } = await admin.storage
        .from('library-files')
        .createSignedUrl(row.bundle_path as string, 300);
      if (signErr || !signed) return json({ error: 'Could not sign bundle URL' }, 500);
      return json({ url: signed.signedUrl });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
