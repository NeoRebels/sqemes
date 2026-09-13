import type { Persona, Prompt, WorkspaceFile } from '../types';

// SQEM-071 — single source of truth for the workspace tag vocabulary.
// The union of tags used by playbooks (single `tag`), files (`tags[]`) and — since SQEM-393 —
// personas (`tags[]`, one in the UI), de-duped and sorted. Used by the Playbooks, Files and
// Personas tag filters so the vocabulary is managed in one place.
//
// ⚠️ `personas` is optional because the Playbooks and Files pages do not load personas (they live
// outside the store, see the header of `pages/Personas.tsx`); their filters show the tags of what
// they list plus files, the Personas filter shows all three. A tag that exists only on a persona
// therefore appears on the Personas page alone — the same asymmetry a file-only tag has today.
export function collectWorkspaceTags(
  prompts: Prompt[],
  files: WorkspaceFile[],
  personas: Pick<Persona, 'tags'>[] = [],
): string[] {
  const set = new Set<string>();
  for (const p of prompts) {
    if (p.tag) set.add(p.tag);
  }
  for (const f of files) {
    for (const t of f.tags) set.add(t);
  }
  for (const p of personas) {
    for (const t of p.tags) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
