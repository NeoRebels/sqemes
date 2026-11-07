// SQEM-658 — the text of a Word, Excel or PowerPoint file, read in the BROWSER, stored by the server.
//
// ⛔ Why the browser reads and the server only stores: an edge function has ~2 s of pure CPU, a
// platform limit we cannot raise. A workbook of a few MB already killed a worker in testing ("CPU Time
// exceeded", 2026-11-06) before the reader was made faster; a 15 MB one — the upload limit — cannot
// be promised on the server at all. The browser has no such limit and holds the file anyway while
// uploading. So the app reads it there (`lib/officeAttachment.ts` → `officeText.ts`, the same reader
// the server uses) and hands the text here; `read_context_file` then serves the stored text without
// computing anything, in sqemes Chat and over MCP.
//
// `workspace_file_texts` stays server-only (SQEM-500: RLS on, no policies, no client privileges);
// this function is the one door, and it checks what RLS would:
//   - the caller is an admin or editor of the file's workspace (the same rule as uploading,
//     `workspace_files_insert`) — so nobody can give a file a text who could not replace the file;
//   - the file is an Office file by its name;
//   - the text is what the current reader produces (header with the file name and
//     OFFICE_READER_MARKER), within the reader's cap.
//
// Body: { fileId, text }  — store (overwrites a text from an older reader).
//       { pending: true, workspaceId } — the Office files of a workspace without a current text, so
//                                       the Files page can prepare them (MCP uploads, older files).

import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { officeKindOf, OFFICE_READER_MARKER, MAX_OFFICE_TEXT_CHARS } from '../_shared/officeText.ts';
import { m as txt, requestLocale } from '../_shared/locale.ts';

/** The reader's cap plus the truncation note and the header — anything longer is not its output. */
const MAX_STORED_CHARS = MAX_OFFICE_TEXT_CHARS + 4000;
/** At most this many files per "pending" answer; the Files page prepares a few per visit. */
const PENDING_LIMIT = 20;

Deno.serve(async (req) => {
  const locale = requestLocale(req);
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const admin = createAdminClient();
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return json({ error: txt.srv_unauthorized({}, { locale }) }, 401);

    const body = await req.json().catch(() => ({}));
    const canWrite = async (workspaceId: string) => {
      const { data } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
      return data?.role === 'admin' || data?.role === 'editor';
    };

    // ---- which Office files still need a text ----------------------------------------------------
    if (body?.pending === true && typeof body.workspaceId === 'string') {
      if (!(await canWrite(body.workspaceId))) return json({ files: [] });
      const { data: rows } = await admin.from('workspace_files')
        .select('id, name, size_bytes, storage_path, workspace_file_texts(content)')
        .eq('workspace_id', body.workspaceId);
      const files = ((rows ?? []) as any[])
        .filter(r => officeKindOf(r.name))
        .filter(r => {
          const e = r.workspace_file_texts;
          const c = Array.isArray(e) ? e[0]?.content : e?.content;
          return typeof c !== 'string' || !c.includes(OFFICE_READER_MARKER);
        })
        .slice(0, PENDING_LIMIT)
        .map(r => ({ id: r.id, name: r.name, sizeBytes: r.size_bytes ?? 0, storagePath: r.storage_path }));
      return json({ files });
    }

    // ---- store one text --------------------------------------------------------------------------
    const fileId = typeof body?.fileId === 'string' ? body.fileId : '';
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!fileId || !text) return json({ error: 'fileId and text are required' }, 400);

    const { data: file } = await admin.from('workspace_files').select('id, workspace_id, name').eq('id', fileId).maybeSingle();
    // A file the caller may not write answers like one that does not exist (no existence oracle).
    if (!file || !(await canWrite(file.workspace_id))) return json({ error: txt.srv_not_found({}, { locale }) }, 404);
    if (!officeKindOf(file.name)) return json({ error: 'Not an Office file' }, 400);

    const base = String(file.name).split('/').pop() ?? '';
    if (!text.startsWith(`File: ${base} (`) || !text.includes(OFFICE_READER_MARKER) || text.length > MAX_STORED_CHARS) {
      return json({ error: 'Not the output of the current reader' }, 400);
    }

    const { error } = await admin.from('workspace_file_texts')
      .upsert([{ file_id: file.id, workspace_id: file.workspace_id, content: text }], { onConflict: 'file_id' });
    if (error) {
      console.error('[store-file-text] upsert failed:', error.message);
      return json({ error: 'Could not store the text' }, 500);
    }
    return json({ ok: true });
  } catch (e) {
    console.error('[store-file-text] failed:', (e as Error)?.message);
    return json({ error: 'Internal error' }, 500);
  }
});
