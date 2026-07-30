import { supabase } from '../supabase';
import type { Database } from '../database.types';
import type { LibraryTemplate, TemplateCategory, Variable, Step, PromptKind, AssistantBrandConfig, Prompt, WorkspaceFile } from '../../types';
import { buildBundle, readBundle, importBundle } from '../templateBundle';
import { scanForInjection } from '../injectionScan';
import { IS_SELF_HOSTED, MARKETPLACE_API_URL, MARKETPLACE_ENABLED } from '../env';

// ---- SQEM-176/178 — global marketplace source ------------------------------------------------------
// The marketplace lives in the Cloud (single source of truth). Cloud uses its local Supabase (below).
// Self-host reads it over the public `marketplace-public` endpoint (SQEM-177) — browse + copy only.
async function marketplaceApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(MARKETPLACE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Marketplace error ${res.status}`);
  return json as T;
}

// library_templates gained UGC columns (SQEM-163) not yet in the generated types — a loose row type.
export type LibraryTemplateRow = Database['public']['Tables']['library_templates']['Row'] & {
  workspace_id?: string | null; status?: string | null; bundle_path?: string | null; content?: string | null; preview?: unknown;
  score?: number; vote_count?: number; scan_risk?: string | null; scan_reasons?: unknown; source_prompt_id?: string | null; content_hash?: string | null;
};

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// UGC columns beyond the base curated select.
export const UGC_COLS = 'workspace_id, status, bundle_path, content, preview, score, vote_count, scan_risk, scan_reasons';

export function rowToLibraryTemplate(row: LibraryTemplateRow): LibraryTemplate {
  return {
    id: row.id,
    kind: (row.kind || 'prompt') as PromptKind,
    title: row.title,
    description: row.description,
    category: row.category as TemplateCategory,
    tags: row.tags || [],
    variables: (row.variables || []) as unknown as Variable[],
    steps: (row.steps || []) as unknown as Step[],
    systemInstruction: row.system_instruction ?? undefined,
    brandConfig: row.brand_config ? (row.brand_config as unknown as AssistantBrandConfig) : undefined,
    createdBy: row.created_by || '',
    usageCount: row.usage_count,
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    content: row.content ?? undefined,
    workspaceId: row.workspace_id ?? null,
    status: (row.status as LibraryTemplate['status']) ?? 'published',
    bundlePath: row.bundle_path ?? null,
    // On Cloud the presence of bundle_path implies a bundle; the public endpoint (self-host) omits the
    // path (it embeds the workspace id) and sends has_bundle instead. Either drives the copy path.
    hasBundle: !!(row.bundle_path || (row as { has_bundle?: boolean }).has_bundle),
    preview: (row.preview as LibraryTemplate['preview']) ?? undefined,
    score: (row as { score?: number }).score ?? 0,
    voteCount: (row as { vote_count?: number }).vote_count ?? 0,
    scanRisk: ((row as { scan_risk?: string | null }).scan_risk as LibraryTemplate['scanRisk']) ?? null,
    scanReasons: ((row as { scan_reasons?: string[] }).scan_reasons as string[]) ?? [],
    source: (row as { source?: string }).source ?? 'cloud',
    publisherName: (row as { marketplace_publishers?: { display_name?: string } }).marketplace_publishers?.display_name ?? null,
  };
}

function libraryTemplateToRow(template: Partial<LibraryTemplate>) {
  const row: Record<string, unknown> = {};
  if (template.kind !== undefined) row.kind = template.kind;
  if (template.title !== undefined) row.title = template.title;
  if (template.description !== undefined) row.description = template.description;
  if (template.category !== undefined) row.category = template.category;
  if (template.tags !== undefined) row.tags = template.tags;
  if (template.variables !== undefined) row.variables = JSON.parse(JSON.stringify(template.variables));
  if (template.steps !== undefined) row.steps = JSON.parse(JSON.stringify(template.steps));
  if (template.systemInstruction !== undefined) row.system_instruction = template.systemInstruction || null;
  if (template.brandConfig !== undefined) row.brand_config = template.brandConfig ? JSON.parse(JSON.stringify(template.brandConfig)) : null;
  if (template.createdBy) row.created_by = template.createdBy;
  if (template.published !== undefined) row.published = template.published;
  row.updated_at = new Date().toISOString();
  return row;
}

export async function fetchLibraryTemplates(): Promise<LibraryTemplate[]> {
  // Self-host reads the global Cloud marketplace over the public endpoint (SQEM-178).
  if (IS_SELF_HOSTED) {
    if (!MARKETPLACE_ENABLED) return [];
    const { listings } = await marketplaceApi<{ listings: unknown[] }>('list');
    return (listings || []).map(r => rowToLibraryTemplate(r as LibraryTemplateRow));
  }
  const { data, error } = await supabase
    .from('library_templates')
    .select(`id, kind, title, description, category, tags, steps, variables, system_instruction, brand_config, usage_count, published, created_by, created_at, updated_at, ${UGC_COLS}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(r => rowToLibraryTemplate(r as unknown as LibraryTemplateRow));
}

export async function fetchLibraryTemplateDetail(id: string): Promise<LibraryTemplate> {
  if (IS_SELF_HOSTED) {
    const { listing } = await marketplaceApi<{ listing: unknown }>('detail', { id });
    return rowToLibraryTemplate(listing as LibraryTemplateRow);
  }
  const { data, error } = await supabase
    .from('library_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return rowToLibraryTemplate(data);
}

export async function createLibraryTemplate(template: Omit<LibraryTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<LibraryTemplate> {
  const row = libraryTemplateToRow(template);
  const { data, error } = await supabase
    .from('library_templates')
    .insert(row as unknown as Database['public']['Tables']['library_templates']['Insert'])
    .select();

  if (error) throw error;
  return rowToLibraryTemplate(data![0]);
}

export async function updateLibraryTemplate(template: LibraryTemplate): Promise<LibraryTemplate> {
  const row = libraryTemplateToRow(template);
  const { data, error } = await supabase
    .from('library_templates')
    .update(row)
    .eq('id', template.id)
    .select();

  if (error) throw error;
  return rowToLibraryTemplate(data![0]);
}

export async function deleteLibraryTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('library_templates')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function copyTemplateToWorkspace(
  templateId: string,
  workspaceId: string,
  userId: string,
): Promise<string> {
  // 1. Fetch the template
  const { data: tpl, error: fetchErr } = await supabase
    .from('library_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (fetchErr || !tpl) throw fetchErr || new Error('Template not found');

  // 2. Build new prompt row with fresh step IDs
  const steps = ((tpl.steps || []) as unknown as Step[]).map(s => ({
    ...s,
    id: crypto.randomUUID(),
  }));

  const promptRow = {
    workspace_id: workspaceId,
    kind: (tpl.kind as string | null) ?? 'prompt',
    title: tpl.title,
    description: tpl.description,
    tag: (tpl.tags as string[] | null)?.[0] ?? null,
    variables: tpl.variables,
    steps: JSON.parse(JSON.stringify(steps)),
    content: (steps[0]?.content as string | undefined) ?? '',
    system_instruction: (tpl.system_instruction as string | null) ?? null,
    brand_config: (tpl.brand_config as unknown) ?? null,
    created_by: userId,
    usage_count: 0,
    is_favorite: false,
    source_template_id: templateId,
  };

  const { data: prompt, error: insertErr } = await supabase
    .from('prompts')
    .insert(promptRow)
    .select();

  if (insertErr) throw insertErr;

  // 3. Increment usage count via RPC
  await supabase.rpc('increment_template_usage', { template_id: templateId });

  return prompt![0].id;
}

// ---- SQEM-163 — user-contributed marketplace -------------------------------------------------------

const client = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** Publish a workspace template to the marketplace as a moderated bundle snapshot (submit-for-review). */
export async function publishToMarketplace(input: {
  workspaceId: string; template: Prompt; allFiles: WorkspaceFile[]; userId: string; category?: TemplateCategory;
}): Promise<LibraryTemplate> {
  const { workspaceId, template, allFiles, userId, category } = input;

  // SQEM-169 — content hash + duplicate pre-check (a friendly message; the DB partial-unique index is
  // the backstop). Blocked only while an earlier listing is still pending/published.
  const contentHash = await sha256Hex(`${template.title} ${template.description} ${template.content}`);
  const { data: dupes } = await client.from('library_templates')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('status', ['pending', 'published'])
    .or(`source_prompt_id.eq.${template.id},content_hash.eq.${contentHash}`);
  if (dupes && dupes.length) throw new Error('This template is already in the Marketplace (published or pending review).');

  const { blob, manifest } = await buildBundle([template], allFiles);

  // SQEM-169 — heuristic injection scan (advisory; shown to admins in the review queue).
  const scan = scanForInjection(template.content, template.systemInstruction, template.description, ...(manifest.skills || []).map(s => s.content));

  const path = `${workspaceId}/${crypto.randomUUID()}/bundle.sqemes.zip`;
  const { error: upErr } = await supabase.storage.from('library-files').upload(path, blob, { contentType: 'application/zip' });
  if (upErr) throw upErr;

  const preview = {
    fileNames: (manifest.files || []).map(f => f.name),
    fileCount: (manifest.files || []).length,
    skillCount: (manifest.skills || []).length,
  };
  const { data, error } = await client.from('library_templates').insert({
    workspace_id: workspaceId,
    kind: template.kind,
    title: template.title,
    description: template.description,
    category: category ?? 'General',
    tags: template.tag ? [template.tag] : [],
    variables: JSON.parse(JSON.stringify(template.variables || [])),
    content: template.content,
    system_instruction: template.systemInstruction || null,
    brand_config: template.brandConfig ?? null,
    created_by: userId,
    published: false,   // submit-for-review — an admin approves
    status: 'pending',
    bundle_path: path,
    preview,
    source_prompt_id: template.id,
    content_hash: contentHash,
    scan_risk: scan.risk,
    scan_reasons: scan.reasons,
  }).select(`id, kind, title, description, category, tags, steps, variables, system_instruction, brand_config, usage_count, published, created_by, created_at, updated_at, ${UGC_COLS}`).single();
  if (error) {
    await supabase.storage.from('library-files').remove([path]);
    // A race that hit the partial-unique dedup index → the same friendly message.
    if ((error as { code?: string }).code === '23505') throw new Error('This template is already in the Marketplace (published or pending review).');
    throw error;
  }
  return rowToLibraryTemplate(data as unknown as LibraryTemplateRow);
}

/** Self-host copy of a no-bundle (curated) listing: build a local prompt from the in-memory listing
 *  fields (there is no local library_templates row to fetch). source_template_id is left null because it
 *  FKs to library_templates(id) — the Cloud listing id does not exist in the self-host DB (SQEM-178). */
async function copyListingFieldsToWorkspace(listing: LibraryTemplate, workspaceId: string, userId: string): Promise<void> {
  const steps = ((listing.steps || []) as Step[]).map(s => ({ ...s, id: crypto.randomUUID() }));
  const { error } = await supabase.from('prompts').insert({
    workspace_id: workspaceId,
    kind: listing.kind ?? 'prompt',
    title: listing.title,
    description: listing.description,
    tag: listing.tags?.[0] ?? null,
    variables: JSON.parse(JSON.stringify(listing.variables || [])),
    steps: JSON.parse(JSON.stringify(steps)),
    content: listing.content ?? (steps[0]?.content as string | undefined) ?? '',
    system_instruction: listing.systemInstruction ?? null,
    brand_config: listing.brandConfig ? JSON.parse(JSON.stringify(listing.brandConfig)) : null,
    created_by: userId,
    usage_count: 0,
    is_favorite: false,
  });
  if (error) throw error;
}

/** Copy a listing into a workspace. UGC listings (with a bundle) apply the full bundle (files + skills);
 *  curated listings fall back to the text-only copy. Returns the new prompt id (or null for a bundle copy). */
export async function copyListingToWorkspace(listing: LibraryTemplate, workspaceId: string, userId: string): Promise<void> {
  // Self-host: the marketplace is the global Cloud one — copy via the public endpoint into the local
  // workspace. Bundle listings download the bundle (files + skills); curated ones copy their fields.
  if (IS_SELF_HOSTED) {
    if (listing.hasBundle) {
      const { url } = await marketplaceApi<{ url: string }>('bundle', { listingId: listing.id });
      const blob = await (await fetch(url)).blob();
      const { zip, manifest } = await readBundle(new File([blob], 'bundle.sqemes.zip'));
      await importBundle(zip, manifest, workspaceId, userId);
    } else {
      await copyListingFieldsToWorkspace(listing, workspaceId, userId);
    }
    return;
  }
  if (!listing.bundlePath) { await copyTemplateToWorkspace(listing.id, workspaceId, userId); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${FUNCTIONS_URL}/get-marketplace-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ listingId: listing.id }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) throw new Error(json.error || `Error ${res.status}`);
  const blob = await (await fetch(json.url)).blob();
  const { zip, manifest } = await readBundle(new File([blob], 'bundle.sqemes.zip'));
  await importBundle(zip, manifest, workspaceId, userId);
  await supabase.rpc('increment_template_usage', { template_id: listing.id });
}

/** Report a listing (any authenticated user). */
export async function reportListing(listingId: string, reason: string, details?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await client.from('library_template_reports').insert({
    library_template_id: listingId, reporter_id: user?.id ?? null, reason, details: details || null,
  });
  if (error) throw error;
}

// Sqemes-admin marketplace moderation + publisher management moved to `lib/api/marketplaceAdmin.ts`
// (SQEM-182) — a Cloud-only module pruned from the self-host export.

// ---- SQEM-169 — votes -------------------------------------------------------------------------------

/** Cast (or toggle off) a vote. value = 1 (up) or -1 (down). Clicking the active direction clears it. */
export async function voteListing(listingId: string, value: 1 | -1): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: existing } = await client.from('library_template_votes')
    .select('id, value').eq('library_template_id', listingId).eq('user_id', user.id).maybeSingle();
  if (existing && existing.value === value) {
    const { error } = await client.from('library_template_votes').delete().eq('id', existing.id);
    if (error) throw error;
  } else if (existing) {
    const { error } = await client.from('library_template_votes').update({ value }).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await client.from('library_template_votes').insert({ library_template_id: listingId, user_id: user.id, value });
    if (error) throw error;
  }
}

/** The caller's own votes, as a map of listingId → value (for highlighting the active direction). */
export async function fetchMyVotes(): Promise<Record<string, number>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await client.from('library_template_votes').select('library_template_id, value').eq('user_id', user.id);
  const out: Record<string, number> = {};
  (data || []).forEach((v: { library_template_id: string; value: number }) => { out[v.library_template_id] = v.value; });
  return out;
}

// Reports + publishers admin API moved to `lib/api/marketplaceAdmin.ts` (SQEM-182, Cloud-only, pruned).

// ---- SQEM-181 — self-host publish (submit to the global marketplace via the api-sidecar proxy) --------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Self-host: whether this instance has a publisher token configured (so submitting is possible). The
 *  token lives server-side in the api-sidecar; this only reveals a boolean, never the token. */
export async function fetchCanPublish(): Promise<boolean> {
  try {
    const res = await fetch('/api/marketplace-submit', { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    return !!(json as { canPublish?: boolean }).canPublish;
  } catch {
    return false;
  }
}

/** Self-host: submit a template to the global marketplace review queue via the api-sidecar proxy
 *  (which adds the publisher token). Builds the bundle locally and posts it as base64. */
export async function submitToMarketplaceViaProxy(template: Prompt, allFiles: WorkspaceFile[], category: TemplateCategory): Promise<void> {
  const { blob } = await buildBundle([template], allFiles);
  const bundle = await blobToBase64(blob);
  const res = await fetch('/api/marketplace-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle, category }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Submit failed (${res.status})`);
}
