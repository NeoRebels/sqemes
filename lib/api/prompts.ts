import { supabase } from '../supabase';
import { fetchTemplateAccess, setTemplateAccess } from './templateAccess';
import type { Database } from '../database.types';
import type { Prompt, PromptKind, Variable, AssistantBrandConfig } from '../../types';

export type PromptRow = {
  id: string;
  workspace_id?: string;
  kind?: string;
  title: string;
  description: string;
  tag: string | null;
  variables: unknown;
  steps?: unknown;
  content?: string;
  system_instruction?: string | null;
  context_file_ids?: string[];
  skill_ids?: string[];
  model?: string | null;
  created_by: string | null;
  usage_count: number;
  is_favorite?: boolean;
  source_template_id?: string | null;
  published?: boolean;
  brand_config?: unknown;
  created_at: string;
  updated_at: string;
};

export function rowToPrompt(row: PromptRow, favoriteIds?: Set<string>): Prompt {
  const steps = Array.isArray(row.steps) ? row.steps as any[] : [];
  const content = row.content ?? (steps[0]?.content as string | undefined) ?? '';

  return {
    id: row.id,
    workspaceId: row.workspace_id || '',
    kind: (row.kind || 'prompt') as PromptKind,
    title: row.title,
    description: row.description,
    tag: row.tag ?? null,
    variables: (row.variables || []) as Variable[],
    content,
    systemInstruction: row.system_instruction ?? undefined,
    contextFileIds: row.context_file_ids || [],
    skillIds: row.skill_ids || [],
    model: row.model ?? undefined,
    aiGeneratedAt: row.ai_generated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || '',
    usageCount: row.usage_count,
    isFavorite: favoriteIds ? favoriteIds.has(row.id) : row.is_favorite ?? false,
    sourceTemplateId: row.source_template_id ?? undefined,
    published: row.published,
    hadMultipleSteps: steps.length > 1,
    brandConfig: row.brand_config as AssistantBrandConfig | undefined,
  };
}

function promptToRow(prompt: Partial<Prompt>, workspaceId: string) {
  const row: Record<string, unknown> = { workspace_id: workspaceId };
  if (prompt.kind !== undefined) row.kind = prompt.kind;
  // SQEM-265 — only ever written on create, by the wizard. Never inferred, never backfilled.
  if (prompt.aiGeneratedAt !== undefined) row.ai_generated_at = prompt.aiGeneratedAt;
  if (prompt.title !== undefined) row.title = prompt.title;
  if (prompt.description !== undefined) row.description = prompt.description;
  if (prompt.tag !== undefined) row.tag = prompt.tag;
  if (prompt.variables !== undefined) row.variables = JSON.parse(JSON.stringify(prompt.variables));
  if (prompt.content !== undefined) row.content = prompt.content;
  if (prompt.systemInstruction !== undefined) row.system_instruction = prompt.systemInstruction || null;
  if (prompt.contextFileIds !== undefined) row.context_file_ids = prompt.contextFileIds;
  if (prompt.skillIds !== undefined) row.skill_ids = prompt.skillIds;
  if (prompt.model !== undefined) row.model = prompt.model || null;
  if (prompt.createdBy) row.created_by = prompt.createdBy;
  if (prompt.usageCount !== undefined) row.usage_count = prompt.usageCount;
  if (prompt.published !== undefined) row.published = prompt.published;
  if (prompt.brandConfig !== undefined) row.brand_config = prompt.brandConfig ?? null;
  row.updated_at = new Date().toISOString();
  return row;
}

const PROMPT_SELECT = 'id, workspace_id, kind, title, description, tag, steps, content, system_instruction, brand_config, context_file_ids, skill_ids, model, variables, created_at, updated_at, usage_count, published, source_template_id, created_by';

export async function fetchPrompts(workspaceId: string, userId: string) {
  const [promptsResult, favoritesResult] = await Promise.all([
    supabase
      .from('prompts')
      .select(PROMPT_SELECT)
      .eq('workspace_id', workspaceId)
      .eq('kind', 'prompt')
      .order('created_at', { ascending: false }),
    supabase
      .from('user_prompt_favorites')
      .select('prompt_id')
      .eq('user_id', userId),
  ]);

  if (promptsResult.error) throw promptsResult.error;
  if (favoritesResult.error) throw favoritesResult.error;

  const favoriteIds = new Set((favoritesResult.data || []).map(f => f.prompt_id));
  return (promptsResult.data || []).map(row => rowToPrompt(row as unknown as PromptRow, favoriteIds));
}

/**
 * SQEM-267 — every template in the workspace, all three kinds, for a complete export.
 *
 * `fetchPrompts` filters `kind = 'prompt'` and `fetchSkills` filters `kind = 'skill'`, so neither is
 * "everything" and composing them would still miss assistants. **Article 20 GDPR is about the data
 * the person provided, not about the subset one page happens to list** — an export that silently
 * omitted a kind would be worse than no export, because it looks complete.
 */
export async function fetchAllTemplates(workspaceId: string, userId: string): Promise<Prompt[]> {
  const [templatesResult, favoritesResult] = await Promise.all([
    supabase
      .from('prompts')
      .select(PROMPT_SELECT)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_prompt_favorites')
      .select('prompt_id')
      .eq('user_id', userId),
  ]);

  if (templatesResult.error) throw templatesResult.error;
  if (favoritesResult.error) throw favoritesResult.error;

  const favoriteIds = new Set((favoritesResult.data || []).map(f => f.prompt_id));
  return (templatesResult.data || []).map(row => rowToPrompt(row as unknown as PromptRow, favoriteIds));
}

export async function fetchSkills(workspaceId: string): Promise<Prompt[]> {
  const { data, error } = await supabase
    .from('prompts')
    .select(PROMPT_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('kind', 'skill')
    .order('title', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => rowToPrompt(row as unknown as PromptRow));
}

// SQEM-087 — the user's favourite prompt ids, for wiring `isFavorite` onto templates of
// every kind. `fetchPrompts` already applies this to prompts; skills/assistants are loaded
// by separate fetchers that don't, so the store applies this set to them.
export async function fetchFavoriteIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('user_prompt_favorites')
    .select('prompt_id')
    .eq('user_id', userId);
  if (error) throw error;
  return new Set((data || []).map(f => f.prompt_id));
}

export async function setFavorite(promptId: string, userId: string, isFavorite: boolean) {
  if (isFavorite) {
    const { error } = await supabase
      .from('user_prompt_favorites')
      .insert({ user_id: userId, prompt_id: promptId });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('user_prompt_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('prompt_id', promptId);
    if (error) throw error;
  }
}

export async function fetchPromptDetail(id: string): Promise<Prompt> {
  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return rowToPrompt(data as unknown as PromptRow);
}

export async function createPrompt(prompt: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>, workspaceId: string) {
  const row = promptToRow(prompt, workspaceId);
  const { data, error } = await supabase
    .from('prompts')
    .insert(row as unknown as Database['public']['Tables']['prompts']['Insert'])
    .select();

  if (error) throw error;
  if (!data || data.length === 0) {
    const { data: latest, error: fetchErr } = await supabase
      .from('prompts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (fetchErr) throw fetchErr;
    return rowToPrompt(latest as unknown as PromptRow);
  }
  return rowToPrompt(data[0] as unknown as PromptRow);
}

export async function updatePrompt(prompt: Prompt, workspaceId: string) {
  const row = promptToRow(prompt, workspaceId);
  delete row.workspace_id;
  const { data, error } = await supabase
    .from('prompts')
    .update(row)
    .eq('id', prompt.id)
    .select();

  if (error) throw error;
  return rowToPrompt(data![0] as unknown as PromptRow);
}

export async function deletePrompt(id: string) {
  const { error } = await supabase
    .from('prompts')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// SQEM-241 — the duplicate belongs to whoever made it, not to whoever wrote the original.
//
// `created_by` used to be copied straight off the source, with two consequences. Duplicating a
// colleague's template produced a copy attributed to them, which the person holding it could then
// not set to "Only me" — `can_access_template` matches the creator by id, and that id was somebody
// else's. And duplicating an ownerless template produced another ownerless one, so the backfill in
// `20260817200000_sqem241_template_owner.sql` would have been undone by ordinary use.
export async function duplicatePrompt(prompt: Prompt, workspaceId: string, userId: string) {
  const dup = {
    workspace_id: workspaceId,
    kind: prompt.kind,
    title: `${prompt.title} (Copy)`,
    description: prompt.description,
    tag: prompt.tag ?? null,
    variables: JSON.parse(JSON.stringify(prompt.variables)),
    content: prompt.content,
    system_instruction: prompt.systemInstruction || null,
    context_file_ids: prompt.contextFileIds || [],
    skill_ids: prompt.skillIds || [],
    model: prompt.model || null,
    created_by: userId || null,
    usage_count: 0,
    is_favorite: false,
    brand_config: prompt.brandConfig ?? null,
  };

  const { data, error } = await supabase
    .from('prompts')
    .insert(dup)
    .select();

  if (error) throw error;
  const created = rowToPrompt(data![0] as unknown as PromptRow);

  // SQEM-246 — a copy is never more open than its original.
  //
  // Duplicating used to write the row and nothing else, and no rows in `template_access` means "no
  // rules = open to everyone". So duplicating a template restricted to three people published its
  // contents to the whole workspace, without anyone being asked. Barely exploitable — you had to be
  // able to see it to duplicate it — but the *contents become visible to third parties*, which is
  // exactly what a restriction is for.
  //
  // Rules are copied verbatim, including legacy role rows: preserving the source's state is what
  // makes "never more open" true, and normalising it here would be a second place deciding what a
  // rule means (see SQEM-238 for how that goes).
  try {
    const access = await fetchTemplateAccess(prompt.id);
    if (access.hasRules) await setTemplateAccess(created.id, workspaceId, access);
  } catch (err) {
    // The dangerous direction is a surviving copy with no rules. Roll the duplicate back rather than
    // leave a restricted template's contents sitting in the open behind a toast nobody reads.
    await supabase.from('prompts').delete().eq('id', created.id);
    throw new Error(
      `Duplicated, but its access rules could not be applied — the copy was removed so it could not stay more open than the original. ${err instanceof Error ? err.message : ''}`.trim(),
    );
  }

  return created;
}

/** The fields of an embedded skill the launch flow needs to compose its `<skill: …>` block. */
export type ResolvedSkill = { id: string; title: string; content: string; contextFileIds: string[] };

/**
 * SQEM-144 — resolve a template's embedded skills transparently via the `resolve-template-skills`
 * edge function (service role, authorized by access to THIS template). A skill restricted away
 * from the caller is still returned as long as it is embedded in a template the caller can access,
 * so the composed prompt never silently loses skill context. Callers should fall back to the
 * client store if this throws (graceful degradation — worst case is the prior RLS-filtered set).
 */
export async function fetchResolvedSkills(templateId: string): Promise<ResolvedSkill[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-template-skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ templateId }),
  });
  if (!res.ok) throw new Error(`resolve-template-skills returned ${res.status}`);
  const json = await res.json();
  return ((json.skills ?? []) as { id: string; title: string; content: string; context_file_ids: string[] | null }[])
    .map(s => ({ id: s.id, title: s.title, content: s.content, contextFileIds: s.context_file_ids ?? [] }));
}
