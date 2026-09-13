import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectWorkspaceTags } from '../../lib/workspaceTags';
import type { Prompt, WorkspaceFile } from '../../types';

/**
 * SQEM-393 — the Personas archive gets what the Playbooks archive has had since SQEM-071/087: a star
 * per card with a Favorites toggle, and a tag per persona with a tag filter — the same components,
 * the same registry (`workspace.tags`), the same optimistic shape.
 *
 * `personas.tags` existed since SQEM-324 as an array nobody wrote or read. The UI exposes ONE tag and
 * stores `[tag]`, so the column, the API and the bundle format are untouched.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-393 — the tag vocabulary includes personas', () => {
  const prompt = (tag: string | null) => ({ tag } as Prompt);
  const file = (...tags: string[]) => ({ tags } as WorkspaceFile);

  it('unions playbook, file and persona tags, de-duped and sorted', () => {
    expect(collectWorkspaceTags([prompt('sales'), prompt(null)], [file('legal', 'sales')], [{ tags: ['onboarding'] }, { tags: [] }]))
      .toEqual(['legal', 'onboarding', 'sales']);
  });

  it('stays exactly what it was for callers that pass no personas', () => {
    // The Playbooks and Files pages do not load personas (they live outside the store).
    expect(collectWorkspaceTags([prompt('a')], [file('b')])).toEqual(['a', 'b']);
  });
});

describe('SQEM-393 — the migration', () => {
  const SQL = read('supabase/migrations/20260913120000_sqem393_persona_favorites.sql');

  it('mirrors user_prompt_favorites: per user, per persona, gone with either, own rows only', () => {
    expect(SQL).toMatch(/create table if not exists public\.user_persona_favorites/);
    expect(SQL).toMatch(/user_id\s+uuid not null references public\.profiles on delete cascade/);
    expect(SQL).toMatch(/persona_id uuid not null references public\.personas on delete cascade/);
    expect(SQL).toMatch(/primary key \(user_id, persona_id\)/);
    expect(SQL).toMatch(/enable row level security/);
    for (const op of ['select', 'insert', 'delete']) expect(SQL).toContain(`"user_persona_favorites_${op}"`);
    expect(SQL.match(/user_id = auth\.uid\(\)/g)?.length).toBe(3);
    expect(SQL).not.toMatch(/for update/);
  });

  it('checks its own work', () => {
    expect(SQL).toMatch(/raise exception '\[SQEM-393\]/);
    expect(SQL).toMatch(/expected 3 policies/);
    expect(read('lib/database.types.ts')).toMatch(/user_persona_favorites: \{/);
  });
});

describe('SQEM-393 — the API', () => {
  const api = code(read('lib/api/personas.ts'));

  it('reads the stars with the list when given the user, and never otherwise', () => {
    expect(api).toMatch(/export async function fetchPersonas\(workspaceId: string, userId\?: string\)/);
    expect(api).toMatch(/userId \? fetchPersonaFavoriteIds\(userId\) : Promise\.resolve\(null\)/);
    expect(api).toMatch(/favoriteIds \? \{ \.\.\.persona, isFavorite: favoriteIds\.has\(persona\.id\) \} : persona/);
  });

  it('sets and clears a favourite own-row, tolerating the duplicate insert', () => {
    expect(api).toMatch(/from\('user_persona_favorites'\)\s*\.insert\(\{ user_id: userId, persona_id: personaId \}\)/);
    expect(api).toMatch(/error\.code !== '23505'/);
    expect(api).toMatch(/\.delete\(\)\s*\.eq\('user_id', userId\)\s*\.eq\('persona_id', personaId\)/);
  });
});

describe('SQEM-393 — the archive and the editor', () => {
  const page = code(read('pages/Personas.tsx'));
  const editor = code(read('pages/PersonaEditor.tsx'));

  it('the page loads the list with the user, filters by star and tag, and offers both controls', () => {
    expect(page).toMatch(/fetchPersonas\(workspace\.id, currentUser\.id\)/);
    expect(page).toMatch(/if \(showFavoritesOnly && !p\.isFavorite\) return false;/);
    expect(page).toMatch(/if \(selectedTag && !p\.tags\.includes\(selectedTag\)\) return false;/);
    expect(page).toMatch(/<TagFilter tags=\{allTags\} value=\{selectedTag\} onChange=\{setSelectedTag\} \/>/);
    expect(page).toMatch(/collectWorkspaceTags\(prompts, workspaceFiles, personas \?\? \[\]\)/);
    expect(page).toMatch(/No favourite personas/);
  });

  it('the card carries the star top-right and the tag above the title, one tag, registry-sourced', () => {
    expect(page).toMatch(/topRight=\{\([\s\S]{0,600}void toggleFavorite\(persona\)/);
    expect(page).toMatch(/badges=\{\(\s*<TagEditor\s+tags=\{persona\.tags\.slice\(0, 1\)\}/);
    expect(page).toMatch(/available=\{canEdit && persona\.tags\.length === 0 \? workspace\.tags : \[\]\}/);
    expect(page).toMatch(/updatePersona\(persona\.id, \{ tags \}\)/);
  });

  it('⛔ both writes are optimistic and roll back on failure — the store shape, kept outside the store', () => {
    expect(page).toMatch(/setPersonas\(prev => \(prev \?\? \[\]\)\.map\(p => p\.id === persona\.id \? \{ \.\.\.p, isFavorite: next \} : p\)\);/);
    expect(page).toMatch(/isFavorite: persona\.isFavorite \} : p\)\);/);
    expect(page).toMatch(/tags: persona\.tags \} : p\)\);/);
  });

  it('the editor has the tag field, loads it, and writes it on create and update', () => {
    expect(editor).toMatch(/<TagPicker\s+value=\{tag\}\s+tags=\{workspace\.tags\}/);
    expect(editor).toMatch(/setTag\(persona\.tags\[0\] \?\? null\)/);
    expect(editor).toMatch(/updatePersona\(id, \{ title: title\.trim\(\), description: description\.trim\(\), content, tags: tag \? \[tag\] : \[\] \}\)/);
    expect(editor).toMatch(/content, routes, tags: tag \? \[tag\] : \[\] \}/);
    // a new tag joins the workspace registry, like in the playbook editor
    expect(editor).toMatch(/updateWorkspace\(\{ tags: \[\.\.\.workspace\.tags, created\] \}\)/);
  });
});
