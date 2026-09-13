import type { Persona, Prompt } from '../types';
// ⛔ The SAME composer the MCP server uses — `_shared/libraryQueries.ts` is import-free, so the
// browser imports it directly (the SQEM-378/381 pattern). A copy here would be the twin that drifts.
import { composePersona, toSlug } from '../supabase/functions/_shared/libraryQueries';

/**
 * SQEM-389 — the system instruction a persona contributes to a chat session.
 *
 * Exactly what `get_persona` serves over MCP: the role prose plus a routing table of "when this
 * applies, call `get_template(name)`". The chat's library tools (SQEM-373) then load a route's
 * template only once its condition applies — the point of a persona is that nothing loads up front.
 *
 * ⚠️ Routes whose template is not in `templates` are dropped, not reported: a template can vanish by
 * deletion or by access control, and from here the two are indistinguishable (the SQEM-371 stance).
 * The route's own denormalised title/kind fill in when the template is present but lacks a field.
 */
export function personaInstruction(
  persona: Pick<Persona, 'title' | 'description' | 'content' | 'routes'>,
  templates: Pick<Prompt, 'id' | 'title' | 'kind' | 'description'>[],
): string {
  const byId = new Map(templates.map(t => [t.id, t]));
  const routes = [...persona.routes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap(r => {
      const t = byId.get(r.templateId);
      if (!t) return [];
      return [{
        name: toSlug(t.title),
        title: t.title,
        kind: t.kind,
        condition: r.condition,
        description: t.description ?? '',
      }];
    });
  return composePersona(
    { title: persona.title, description: persona.description, content: persona.content },
    routes,
  );
}
