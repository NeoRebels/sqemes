import { supabase } from '../supabase';
import { IS_SELF_HOSTED, functionCallUrl } from '../env';
import { m } from '../i18n';
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE_BYTES, inferTextMime } from '../uploadTypes';
import { safeStorageFileName } from '../storageKey';
import { classifySkillFile, isUtf8Text, STORAGE_TEXT_MIME } from '../../supabase/functions/_shared/skillFile.ts';
import type { WorkspaceFile } from '../../types';
import type { Database } from '../database.types';

type FileRow = Database['public']['Tables']['workspace_files']['Row'];

function rowToFile(row: FileRow): WorkspaceFile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    tags: row.tags ?? [],
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
  };
}

export async function fetchWorkspaceFiles(workspaceId: string): Promise<WorkspaceFile[]> {
  const { data, error } = await supabase
    .from('workspace_files')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToFile);
}

export async function uploadWorkspaceFile(
  workspaceId: string,
  file: File,
  tags: string[] = [],
): Promise<WorkspaceFile> {
  return storeWorkspaceFile(workspaceId, file, tags, false);
}

/**
 * SQEM-514 — a file that belongs to a SKILL: any type is accepted, decided by its bytes
 * (`classifySkillFile`), because a skill is a folder and may carry schemas, scripts and fonts. Used by
 * every skill import path; the Files page and the chat composer keep `uploadWorkspaceFile`.
 */
export async function uploadSkillFile(workspaceId: string, file: File, tags: string[] = []): Promise<WorkspaceFile> {
  return storeWorkspaceFile(workspaceId, file, tags, true);
}

async function storeWorkspaceFile(
  workspaceId: string,
  file: File,
  tags: string[],
  anyType: boolean,
): Promise<WorkspaceFile> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(m.api_file_too_big());
  }

  let labelMime: string;
  let storageMime: string;
  let uploadBody: Blob;
  if (anyType) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const t = classifySkillFile(file.name, bytes);
    labelMime = t.rowMime;
    storageMime = t.storageMime;
    uploadBody = new Blob([bytes], { type: storageMime });
  } else {
    // A directly-storable type (image / PDF / standard text), or any text/code file recognised by
    // extension. SQEM-514: an unknown extension is accepted too when its bytes ARE text. Text is
    // stored as text/plain to pass the bucket allowlist; the specific mime stays on the row.
    const isStandard = SUPPORTED_MIME_TYPES.has(file.type);
    let inferredMime = inferTextMime(file.name);
    if (!isStandard && !inferredMime && isUtf8Text(new Uint8Array(await file.arrayBuffer()))) {
      inferredMime = STORAGE_TEXT_MIME;
    }
    if (!isStandard && !inferredMime) {
      throw new Error(m.api_file_type({ type: file.type || file.name }));
    }
    labelMime = isStandard ? file.type : inferredMime!;
    const storeAsPlain = !isStandard;
    storageMime = storeAsPlain ? STORAGE_TEXT_MIME : file.type;
    uploadBody = storeAsPlain ? new Blob([await file.text()], { type: STORAGE_TEXT_MIME }) : file;
  }

  const fileId = crypto.randomUUID();
  // SQEM-237 — the browser upload built this key raw while the MCP paths sanitised it. SQEM-111
  // hardened two of the three call sites; this was the third. The row keeps `file.name` unchanged —
  // only the storage key is defused, because the visible name is what a client reads back.
  const storagePath = `${workspaceId}/${fileId}/${safeStorageFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from('workspace-files')
    .upload(storagePath, uploadBody, { contentType: storageMime });
  if (uploadError) {
    // SQEM-515 — the storage policy refuses an upload once the workspace is at its limit, and Storage
    // reports that only as an RLS violation. Say what it is when that is the reason.
    if (/row-level security/i.test(uploadError.message)) {
      const usage = await getWorkspaceStorageUsage(workspaceId).catch(() => null);
      if (usage && usage.limit != null && usage.used >= usage.limit) {
        throw new Error(storageLimitMessage(usage.used, usage.limit));
      }
    }
    throw uploadError;
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('workspace_files')
    .insert({
      id: fileId,
      workspace_id: workspaceId,
      name: file.name,
      mime_type: labelMime,
      size_bytes: file.size,
      storage_path: storagePath,
      tags,
      created_by: user?.id,
    })
    .select()
    .single();

  if (error) {
    await removeOrphanObject(storagePath);
    throw error;
  }

  return rowToFile(data);
}

export async function updateWorkspaceFile(
  id: string,
  patch: { name?: string; tags?: string[] },
): Promise<WorkspaceFile> {
  const { data, error } = await supabase
    .from('workspace_files')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToFile(data);
}

// SQEM-234 — how many templates reference each file, INCLUDING ones the caller cannot see.
//
// The Files page used to count this from the client store, which only holds what RLS lets the viewer
// see. A file attached to someone else's restricted template counted zero and was labelled "Unused",
// which is an invitation to delete precisely the file that must not be deleted. The count is not
// computable client-side by design — RLS is hiding the rows that need counting — so it comes from a
// SECURITY DEFINER function that returns numbers only, never titles.
export async function getWorkspaceFileUsage(workspaceId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('workspace_file_usage', { p_workspace_id: workspaceId });
  if (error) throw error;
  return new Map(((data || []) as Array<{ file_id: string; total_templates: number }>)
    .map(r => [r.file_id, r.total_templates]));
}

export async function deleteWorkspaceFile(id: string, storagePath: string): Promise<void> {
  // The real guard is a BEFORE DELETE trigger in the database (SQEM-234): a still-referenced file
  // cannot be removed, and the error below is what surfaces. Checking here as well would only be a
  // suggestion — the same reason SQEM-213 dropped the workspaces_delete policy instead of relying on
  // the client taking the safe path.
  //
  // Storage first would orphan the object when the row delete is refused, so the row goes first.
  //
  // SQEM-515 step B — on Cloud the browser cannot read storage objects, and Storage's remove() needs
  // that read: it would answer 200 with [] and delete nothing (measured). The server deletes instead
  // (`delete-workspace-file`): the row with this user's token — the same RLS and SQEM-234 guard — and
  // then the object, checking that it went. Self-host keeps the browser path and its read policy.
  if (!IS_SELF_HOSTED) {
    const res = await callDeleteFunction({ fileId: id });
    if (res.ok === false) throw new Error(res.error);
    return;
  }
  const { error } = await supabase.from('workspace_files').delete().eq('id', id);
  if (error) throw error;
  await supabase.storage.from('workspace-files').remove([storagePath]);
}

async function callDeleteFunction(body: { fileId: string } | { orphanPath: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'Not authenticated' };
  const res = await fetch(functionCallUrl('delete-workspace-file'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: (json as { error?: string }).error || `Error ${res.status}` };
}

/** Cleans up an object whose row was never written (a failed upload). Best effort — never throws. */
async function removeOrphanObject(storagePath: string): Promise<void> {
  if (IS_SELF_HOSTED) {
    await supabase.storage.from('workspace-files').remove([storagePath]);
    return;
  }
  await callDeleteFunction({ orphanPath: storagePath }).catch(() => undefined);
}

// SQEM-117 — signed download/open URLs are time-limited bearer capabilities: anyone with the URL
// can fetch the file until it expires. Default to a SHORT window (5 min) since opens/downloads and
// context-file reads happen immediately; a leaked/shared link then dies fast. Callers that must
// survive the session (e.g. cached image thumbnails) pass a longer expiry explicitly.
//
// SQEM-515 — on Cloud the SERVER signs (`sign-file-url`): a link the browser signs cannot be counted,
// and the daily download ceiling would be one script away from meaningless. Calls made in the same
// moment (a page of thumbnails, a bundle export) are collected and sent as ONE request per workspace
// and expiry. Self-host keeps signing here: its functions only see an internal URL (`http://kong:8000`)
// and there is no ceiling to count against. ⛔ No other place in the app may call `createSignedUrl` on
// `workspace-files` (tests/unit/signFileUrl.test.ts).
export async function getWorkspaceFileSignedUrl(storagePath: string, expiresIn = 300): Promise<string> {
  if (IS_SELF_HOSTED) {
    const { data, error } = await supabase.storage
      .from('workspace-files')
      .createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }
  return queueSign(storagePath, expiresIn);
}

type Pending = { resolve: (url: string) => void; reject: (e: Error) => void };
const signQueues = new Map<string, Map<string, Pending[]>>();

function queueSign(path: string, expiresIn: number): Promise<string> {
  const ws = path.split('/')[0];
  const key = `${ws}|${expiresIn}`;
  return new Promise<string>((resolve, reject) => {
    let q = signQueues.get(key);
    if (!q) {
      q = new Map();
      signQueues.set(key, q);
      // One tick is enough to collect everything a render or a loop asks for at once.
      setTimeout(() => { void flushSign(key, expiresIn); }, 0);
    }
    const waiting = q.get(path) ?? [];
    waiting.push({ resolve, reject });
    q.set(path, waiting);
  });
}

async function flushSign(key: string, expiresIn: number): Promise<void> {
  const q = signQueues.get(key);
  signQueues.delete(key);
  if (!q) return;
  const all = [...q.keys()];
  const fail = (paths: string[], e: Error) => paths.forEach(p => q.get(p)?.forEach(w => w.reject(e)));
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    for (let i = 0; i < all.length; i += 200) {            // MAX_PATHS_PER_CALL on the server
      const paths = all.slice(i, i + 200);
      const res = await fetch(functionCallUrl('sign-file-url'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, expiresIn }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { fail(paths, new Error(body.error || m.api_file_open({ status: res.status }))); continue; }
      for (const p of paths) {
        const url = body.urls?.[p];
        q.get(p)?.forEach(w => (url ? w.resolve(url) : w.reject(new Error(m.api_file_missing()))));
      }
    }
  } catch (e) {
    fail(all, e as Error);
  }
}

/** SQEM-515 — storage used and allowed for a workspace (Cloud; admins and editors). `null` on self-host. */
export async function getWorkspaceStorageUsage(workspaceId: string): Promise<{ used: number; limit: number | null } | null> {
  if (IS_SELF_HOSTED) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const res = await fetch(functionCallUrl('sign-file-url'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, usage: true }),
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body || typeof body.used !== 'number') return null;
  return { used: body.used, limit: body.limit == null ? null : Number(body.limit) };
}

/**
 * SQEM-515 — the same words the database trigger uses, so the browser and agents read one message.
 * SQEM-611 — in the app language; the English message is still the trigger's sentence word for word.
 */
export function storageLimitMessage(used: number, limit: number): string {
  const mb = (n: number) => Math.round(n / 1048576);
  return m.api_storage_limit({ used: mb(used), limit: mb(limit) });
}
