// SQEM-477 — a playbook's version history. The database writes the versions (a trigger on `prompts`)
// and decides who may see, restore or delete them (RLS, the edit right of SQEM-473); this module only
// reads them and calls the two actions.
import { supabase } from '../supabase';
import { m } from '../i18n';

// Not in the generated database.types (same as template_editors); a thin cast keeps call sites typed.
type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const client = supabase as unknown as Client;

export type VersionFile = { id: string; name: string | null };

export interface TemplateVersionSummary {
  id: string;
  version: number;
  createdBy: string | null;
  createdAt: string;
  note: string | null;
  restoredFrom: number | null;
}

export interface TemplateVersion extends TemplateVersionSummary {
  title: string;
  description: string;
  content: string;
  tag: string | null;
  contextFiles: VersionFile[];
}

const SUMMARY = 'id, version, created_by, created_at, note, restored_from';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toSummary = (r: any): TemplateVersionSummary => ({
  id: r.id, version: r.version, createdBy: r.created_by ?? null, createdAt: r.created_at,
  note: r.note ?? null, restoredFrom: r.restored_from ?? null,
});
const toVersion = (r: any): TemplateVersion => ({
  ...toSummary(r),
  title: r.title ?? '', description: r.description ?? '', content: r.content ?? '', tag: r.tag ?? null,
  contextFiles: Array.isArray(r.context_files) ? r.context_files : [],
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Newest first, without the bodies — a long skill times many versions is too much to load up front. */
export async function fetchVersions(templateId: string): Promise<TemplateVersionSummary[]> {
  const { data, error } = await client.from('template_versions').select(SUMMARY)
    .eq('template_id', templateId).order('version', { ascending: false });
  if (error) throw error;
  return (data || []).map(toSummary);
}

/** Full states of the given versions (the one selected and the one it is compared with). */
export async function fetchVersionStates(ids: string[]): Promise<TemplateVersion[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from('template_versions')
    .select(`${SUMMARY}, title, description, content, tag, context_files`).in('id', ids);
  if (error) throw error;
  return (data || []).map(toVersion);
}

/** Which of a version's files still exist (a file detached since may be invisible, not deleted). */
export async function fetchPresentFiles(versionId: string): Promise<Set<string>> {
  const { data, error } = await client.rpc('template_version_files_present', { p_version_id: versionId });
  if (error) throw error;
  return new Set(((data || []) as (string | { template_version_files_present: string })[])
    .map(r => (typeof r === 'string' ? r : r.template_version_files_present)));
}

/**
 * Write a version's state back. The database records it as a NEW version ("Restored from version N").
 * `version` is null when that state is already the current one; `missingFiles` names attached files
 * that no longer exist and were therefore left out.
 */
export async function restoreVersion(versionId: string): Promise<{ version: number | null; missingFiles: string[] }> {
  const { data, error } = await client.rpc('restore_template_version', { p_version_id: versionId });
  if (error) throw error;
  return { version: data?.version ?? null, missingFiles: Array.isArray(data?.missingFiles) ? data.missingFiles : [] };
}

/** Delete an old version. Refused by the database for the newest one, and without the edit right. */
export async function deleteVersion(versionId: string): Promise<void> {
  const { data, error } = await client.from('template_versions').delete().eq('id', versionId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(m.api_playbook_read_only());
}
