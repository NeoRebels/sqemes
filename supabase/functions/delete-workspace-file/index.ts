// SQEM-515 step B — deleting a workspace file on Cloud, done by the server.
//
// Since step B no client may read `workspace-files` objects, and Storage's `remove()` needs that read:
// without it, it answers 200 with `[]` and deletes nothing (measured on the local stack, 2026-10-17).
// A delete left in the browser would therefore orphan every object silently, and an orphan keeps
// counting against the storage limit. So the server removes the object — and checks that it did.
//
// Body: { fileId: string }     — delete a file: row, then object.
//       { orphanPath: string } — clean up after a failed browser upload: an object with no row.
//
// ⛔ The ROW is deleted with the CALLER's token, so the rules stay exactly where they were: RLS
// (`workspace_files_delete`: admin or editor of the workspace) and the SQEM-234 trigger that refuses a
// file a template still uses. Only once the row is gone does the service key touch storage.
// A file the caller may not delete answers like a file that does not exist (no existence oracle).
// Self-host does not call this: there the browser keeps its read policy and deletes itself.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { workspaceOfPath } from '../_shared/fileLinks.ts';
import { m as txt, requestLocale } from '../_shared/locale.ts';

const BUCKET = 'workspace-files';

Deno.serve(async (req) => {
  const locale = requestLocale(req); // SQEM-612 — refusals in the person's language
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
    if (authError || !user) return json({ error: txt.srv_unauthorized({}, { locale }) }, 401);

    const asUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));

    // Removes one object and proves it went: Storage reports what it removed, and an empty answer is
    // the silent failure this function exists to catch.
    const removeObject = async (path: string): Promise<boolean> => {
      const { data, error } = await admin.storage.from(BUCKET).remove([path]);
      const removed = !error && (data ?? []).some((o: { name?: string }) => o.name === path);
      if (!removed) console.error('[delete-workspace-file] object not removed:', path, error?.message ?? 'empty result');
      return removed;
    };

    // ---- clean up after a failed upload --------------------------------------------------------
    if (typeof body?.orphanPath === 'string') {
      const path = body.orphanPath;
      if (!workspaceOfPath(path)) return json({ error: 'Invalid path' }, 400);
      const { data: ok, error } = await admin.rpc('can_delete_orphan_object', { p_path: path, p_uid: user.id });
      if (error) return json({ error: error.message }, 500);
      if (!ok) return json({ error: txt.srv_not_found({}, { locale }) }, 404);
      return (await removeObject(path)) ? json({ removed: true }) : json({ error: txt.srv_remove_failed({}, { locale }) }, 500);
    }

    // ---- delete a file ---------------------------------------------------------------------------
    const fileId = String(body?.fileId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) return json({ error: 'Missing fileId' }, 400);

    const { data: row } = await admin.from('workspace_files').select('id, workspace_id, storage_path').eq('id', fileId).maybeSingle();
    if (!row) return json({ error: txt.srv_not_found({}, { locale }) }, 404);

    // The caller's own delete: RLS and the SQEM-234 guard decide, as they always did.
    const { error: delErr } = await asUser.from('workspace_files').delete().eq('id', fileId);
    if (delErr) return json({ error: delErr.message, code: delErr.code }, 409);

    const { data: still } = await admin.from('workspace_files').select('id').eq('id', fileId).maybeSingle();
    if (still) return json({ error: txt.srv_not_found({}, { locale }) }, 404); // RLS refused it — answered like a missing file

    // The row is gone; the object goes with it. Only a path inside the row's own workspace is touched.
    if (!row.storage_path || workspaceOfPath(row.storage_path) !== row.workspace_id) {
      console.error('[delete-workspace-file] storage path outside its workspace, not removed:', row.id);
      return json({ deleted: true, objectRemoved: false });
    }
    // The file IS deleted for the person either way; an object that would not go is logged above and
    // reported here, rather than failing a delete the person can no longer undo.
    const removed = await removeObject(row.storage_path);
    return json({ deleted: true, objectRemoved: removed });
  } catch (error) {
    console.error('delete-workspace-file error:', (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
