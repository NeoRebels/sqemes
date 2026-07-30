// SQEM-163 — serve a marketplace listing's bundle (.sqemes.zip) to a copier. The bundle lives in the
// private `library-files` bucket; a copier is (by design) not in the source workspace, so they can't read
// it via storage RLS. This function (service role) authorizes the caller — the listing must be published,
// OR the caller is a Sqemes-admin, OR a member of the source workspace (to preview their own pending
// submission) — then returns a short-lived signed URL to download the bundle. The client applies it via
// importBundle. Read-only; no mutation here.
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const admin = createAdminClient();
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { listingId } = await req.json().catch(() => ({}));
    if (!listingId) return json({ error: 'listingId required' }, 400);

    const { data: row } = await admin.from('library_templates')
      .select('id, workspace_id, status, published, bundle_path').eq('id', listingId).single();
    if (!row || !row.bundle_path) return json({ error: 'Not found' }, 404);

    // Authorize: published (anyone) · sqemes-admin · a member of the source workspace (own submission).
    let allowed = row.published === true || row.status === 'published';
    if (!allowed) {
      const { data: prof } = await admin.from('profiles').select('is_sqemes_admin').eq('id', user.id).single();
      allowed = !!prof?.is_sqemes_admin;
    }
    if (!allowed && row.workspace_id) {
      const { data: mem } = await admin.from('workspace_members').select('user_id')
        .eq('workspace_id', row.workspace_id).eq('user_id', user.id).maybeSingle();
      allowed = !!mem;
    }
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    const { data: signed, error: signErr } = await admin.storage.from('library-files').createSignedUrl(row.bundle_path, 300);
    if (signErr || !signed) return json({ error: 'Could not sign bundle URL' }, 500);
    return json({ url: signed.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
