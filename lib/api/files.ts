import { supabase } from '../supabase';
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE_BYTES, inferTextMime } from '../uploadTypes';
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
  // Accept either a directly-storable type (image / PDF / standard text) or any text/code
  // file recognised by extension. Extension-recognised files are stored as text/plain to
  // pass the bucket allowlist, while their specific mime is kept on the row for the label.
  const isStandard = SUPPORTED_MIME_TYPES.has(file.type);
  const inferredMime = inferTextMime(file.name);
  if (!isStandard && !inferredMime) {
    throw new Error(`Unsupported file type: ${file.type || file.name}`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds the 15 MB size limit');
  }

  const labelMime = isStandard ? file.type : inferredMime!;
  const storeAsPlain = !isStandard;
  const storageMime = storeAsPlain ? 'text/plain' : file.type;
  const uploadBody: Blob = storeAsPlain
    ? new Blob([await file.text()], { type: 'text/plain' })
    : file;

  const fileId = crypto.randomUUID();
  const storagePath = `${workspaceId}/${fileId}/${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('workspace-files')
    .upload(storagePath, uploadBody, { contentType: storageMime });
  if (uploadError) throw uploadError;

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
    await supabase.storage.from('workspace-files').remove([storagePath]);
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

export async function deleteWorkspaceFile(id: string, storagePath: string): Promise<void> {
  await supabase.storage.from('workspace-files').remove([storagePath]);
  const { error } = await supabase.from('workspace_files').delete().eq('id', id);
  if (error) throw error;
}

// SQEM-117 — signed download/open URLs are time-limited bearer capabilities: anyone with the URL
// can fetch the file until it expires. Default to a SHORT window (5 min) since opens/downloads and
// context-file reads happen immediately; a leaked/shared link then dies fast. Callers that must
// survive the session (e.g. cached image thumbnails) pass a longer expiry explicitly.
export async function getWorkspaceFileSignedUrl(storagePath: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from('workspace-files')
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
