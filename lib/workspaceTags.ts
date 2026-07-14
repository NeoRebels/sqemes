import type { Prompt, WorkspaceFile } from '../types';

// SQEM-071 — single source of truth for the workspace tag vocabulary.
// The union of tags used by templates (single `tag`) and files (`tags[]`),
// de-duped and sorted. Used by both the Templates and Files tag filters so
// the vocabulary is managed in one place.
export function collectWorkspaceTags(prompts: Prompt[], files: WorkspaceFile[]): string[] {
  const set = new Set<string>();
  for (const p of prompts) {
    if (p.tag) set.add(p.tag);
  }
  for (const f of files) {
    for (const t of f.tags) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
