// SQEM-324 — Personas: the API layer.
//
// A persona is stored in two places on purpose (see the migration header): the prose in
// `personas.content`, the routes in `persona_templates`. Every read here reassembles them, so no
// caller has to know that — and no caller is tempted to write a route into the text.
import { supabase } from '../supabase';
import type { Persona, PersonaRoute, PromptKind } from '../../types';

export type PersonaRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  created_by: string | null;
  ai_generated_at: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
};

/**
 * The join rows as Supabase returns them with the template embedded.
 *
 * ⚠️ The embed is `prompts!inner`, and the `!inner` is load-bearing: a route whose template the
 * caller cannot read must **disappear**, not arrive as a row with a null template. RLS already
 * filters `prompts`, so an outer join would hand us a route we could name but not open — which is
 * exactly the half-state SQEM-326 exists to prevent, arriving a ticket early through the back door.
 */
type RouteRow = {
  template_id: string;
  condition: string;
  sort_order: number;
  prompts: { title: string; kind: string } | null;
};

export function rowToPersona(row: PersonaRow, routes: PersonaRoute[] = []): Persona {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    content: row.content,
    tags: row.tags || [],
    routes,
    aiGeneratedAt: row.ai_generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || '',
    usageCount: row.usage_count,
  };
}

function routeRowsToRoutes(rows: RouteRow[] | null | undefined): PersonaRoute[] {
  return (rows || [])
    .map(r => ({
      templateId: r.template_id,
      templateTitle: r.prompts?.title,
      templateKind: r.prompts?.kind as PromptKind | undefined,
      condition: r.condition,
      sortOrder: r.sort_order,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Every persona in the workspace the caller may see, with its routes. */
export async function fetchPersonas(workspaceId: string): Promise<Persona[]> {
  const { data, error } = await supabase
    .from('personas')
    .select('*, persona_templates(template_id, condition, sort_order, prompts!inner(title, kind))')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row: any) =>
    rowToPersona(row as PersonaRow, routeRowsToRoutes(row.persona_templates)),
  );
}

export async function fetchPersona(id: string): Promise<Persona | null> {
  const { data, error } = await supabase
    .from('personas')
    .select('*, persona_templates(template_id, condition, sort_order, prompts!inner(title, kind))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return rowToPersona(data as unknown as PersonaRow, routeRowsToRoutes((data as any).persona_templates));
}

export async function createPersona(
  workspaceId: string,
  persona: Pick<Persona, 'title' | 'description' | 'content'> &
    Partial<Pick<Persona, 'tags' | 'routes' | 'aiGeneratedAt'>>,
  createdBy: string | null,
): Promise<Persona> {
  const { data, error } = await supabase
    .from('personas')
    .insert({
      workspace_id: workspaceId,
      title: persona.title,
      description: persona.description ?? '',
      content: persona.content ?? '',
      tags: persona.tags ?? [],
      created_by: createdBy,
      ai_generated_at: persona.aiGeneratedAt ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const created = rowToPersona(data as unknown as PersonaRow);
  if (persona.routes?.length) await setPersonaRoutes(created.id, persona.routes);
  return { ...created, routes: persona.routes ?? [] };
}

export async function updatePersona(
  id: string,
  patch: Partial<Pick<Persona, 'title' | 'description' | 'content' | 'tags'>>,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.tags !== undefined) row.tags = patch.tags;

  const { error } = await supabase.from('personas').update(row).eq('id', id);
  if (error) throw error;
}

/**
 * Replace a persona's routes wholesale.
 *
 * ⚠️ Delete-then-insert rather than a diff, and the reason is not laziness: the primary key is
 * (persona_id, template_id), so a reorder plus a removal expressed as a diff needs three statements
 * in the right order to avoid tripping the key. There is no transaction available from the client,
 * so the honest trade is stated here — **a failure between the two leaves the persona with no
 * routes, not with wrong ones.** Losing the routing is visible immediately and re-savable; a
 * half-applied diff is neither.
 */
export async function setPersonaRoutes(personaId: string, routes: PersonaRoute[]): Promise<void> {
  const { error: delErr } = await supabase
    .from('persona_templates')
    .delete()
    .eq('persona_id', personaId);
  if (delErr) throw delErr;

  if (!routes.length) return;

  const { error } = await supabase.from('persona_templates').insert(
    routes.map((r, i) => ({
      persona_id: personaId,
      template_id: r.templateId,
      condition: r.condition ?? '',
      // Renumbered from the array order rather than trusting `sortOrder`: the list in the editor is
      // the truth about the order, and two routes carrying the same number would sort arbitrarily.
      sort_order: i,
    })),
  );
  if (error) throw error;
}

/**
 * Copy a persona, routes and all.
 *
 * ⚠️ **The copy belongs to whoever made it, not to the original's author** (SQEM-241 settled this
 * for templates). Otherwise duplicating somebody else's persona hands you an object you cannot set
 * to "only me", because `can_access_persona()` matches the *creator*.
 *
 * ⛔ Access rules are not copied. A duplicate starts open: silently inheriting a restriction would
 * produce a persona somebody made and cannot see, which is the confusing direction. Widening is
 * visible and correctable; the reverse is neither.
 */
export async function duplicatePersona(persona: Persona, createdBy: string | null): Promise<Persona> {
  return createPersona(
    persona.workspaceId,
    {
      title: `${persona.title} (Copy)`,
      description: persona.description,
      content: persona.content,
      tags: persona.tags,
      routes: persona.routes,
    },
    createdBy,
  );
}

export async function deletePersona(id: string): Promise<void> {
  const { error } = await supabase.from('personas').delete().eq('id', id);
  if (error) throw error;
}
