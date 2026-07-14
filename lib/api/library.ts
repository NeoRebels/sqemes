import { supabase } from '../supabase';
import type { Database } from '../database.types';
import type { LibraryTemplate, TemplateCategory, Variable, Step, PromptKind, AssistantBrandConfig } from '../../types';

type LibraryTemplateRow = Database['public']['Tables']['library_templates']['Row'];

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
  const { data, error } = await supabase
    .from('library_templates')
    .select('id, kind, title, description, category, tags, steps, variables, system_instruction, brand_config, usage_count, published, created_by, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToLibraryTemplate);
}

export async function fetchLibraryTemplateDetail(id: string): Promise<LibraryTemplate> {
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
