// SQEM-515 — signed download links for workspace files, issued by the server (Cloud).
//
// The browser used to sign links itself (`createSignedUrl` in lib/api/files.ts). A link the browser
// signs cannot be counted, so the daily download ceiling would have been one script away from useless.
// This function is the one place that issues them on Cloud: it checks access, counts the real object
// sizes against today's ceiling, and signs a whole page of paths in one call.
//
// ⛔ Access is checked with the CALLER's own token: the `workspace_files` select below runs under RLS,
// so a path the caller may not see is simply not returned and not signed (SQEM-291's `can_access_file`
// applies unchanged). The service key is used only to count and to sign what that read returned.
//
// Body: { paths: string[], expiresIn?: number }  — every path in ONE workspace's folder
//       { workspaceId: string, usage: true }      — storage used / limit, for Settings (admins, editors)
// Self-host: not called (the browser signs as before — the functions there only see an internal URL);
// if it is, it signs without counting.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import {
  workspaceOfPath, MAX_PATHS_PER_CALL, clampExpiry, onPublicHost, dailyLimitMessage,
} from '../_shared/fileLinks.ts';

const SELF_HOSTED = Deno.env.get('SELF_HOSTED') === 'true';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const admin = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    // The caller's own view of the database: RLS decides what they may see.
    const asUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));

    // ---- usage (Settings) -----------------------------------------------------------------------
    if (body?.usage === true) {
      const ws = String(body.workspaceId ?? '');
      const { data: m } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', ws).eq('user_id', user.id).maybeSingle();
      if (!m || (m.role !== 'admin' && m.role !== 'editor')) return json({ error: 'Not allowed' }, 403);
      if (SELF_HOSTED) return json({ used: null, limit: null });
      const { data, error } = await admin.rpc('workspace_storage_usage', { p_ws: ws });
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ---- sign -----------------------------------------------------------------------------------
    const paths: string[] = Array.isArray(body?.paths) ? [...new Set(body.paths.map(String))] : [];
    if (!paths.length) return json({ error: 'Missing paths' }, 400);
    if (paths.length > MAX_PATHS_PER_CALL) return json({ error: `At most ${MAX_PATHS_PER_CALL} paths per call` }, 400);
    const workspaces = new Set(paths.map(workspaceOfPath));
    if (workspaces.size !== 1 || workspaces.has(null)) {
      return json({ error: 'All paths must belong to one workspace folder' }, 400);
    }
    const ws = [...workspaces][0] as string;
    const expiresIn = clampExpiry(body?.expiresIn ?? 300);

    // Access: only what the caller may read comes back.
    const { data: rows, error: readErr } = await asUser.from('workspace_files')
      .select('storage_path').eq('workspace_id', ws).in('storage_path', paths);
    if (readErr) return json({ error: readErr.message }, 500);
    const allowed = (rows ?? []).map((r: { storage_path: string }) => r.storage_path);
    const missing = paths.filter(p => !allowed.includes(p));
    if (!allowed.length) return json({ urls: {}, missing });

    // Count against today's ceiling (Cloud). The function sums the REAL object sizes itself.
    if (!SELF_HOSTED) {
      const { data: rec, error: recErr } = await admin.rpc('record_file_download', { p_ws: ws, p_paths: allowed });
      if (recErr) {
        // Fail open, like every budget here: a counter that is down must not lock people out of their
        // files. It is logged so a broken counter shows.
        console.error('[sign-file-url] counting failed, signing anyway:', recErr.message);
      } else if (rec && rec.allowed === false) {
        return json({ error: dailyLimitMessage(Number(rec.used_today), Number(rec.day_limit)), code: 'daily_download_limit' }, 429);
      }
    }

    const { data: signed, error: signErr } = await admin.storage.from('workspace-files').createSignedUrls(allowed, expiresIn);
    if (signErr) return json({ error: signErr.message }, 500);

    const publicBase = Deno.env.get('PUBLIC_API_URL') ?? null;
    const urls: Record<string, string> = {};
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl && !s.error) urls[s.path] = onPublicHost(s.signedUrl, publicBase);
    }
    return json({ urls, missing });
  } catch (error) {
    console.error('sign-file-url error:', (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
