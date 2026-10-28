import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, de } from './i18nText';

/**
 * SQEM-606 — one toast per playbook action, and it tells the truth.
 *
 * The pages used to toast "deleted"/"duplicated" before the server answered, and the store then
 * replaced it with its own English "Prompt deleted" — in a German UI too, and after an error the
 * order was success first, failure second. Worse, a failed save in the editor was covered by
 * "Prompt successfully saved" and the dirty flag was reset, so leaving dropped the changes unasked.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-606 — the store reports, the pages do not', () => {
  const store = code(read('store/prompts.tsx'));
  const templates = code(read('pages/Templates.tsx'));
  const editor = code(read('pages/TemplateEditor.tsx'));

  it('delete and duplicate toast once, from the store, after the await', () => {
    expect(store).toMatch(/await promptsApi\.deletePrompt\(id\);[\s\S]{0,120}showToast\(m\.pb_deleted\(\), 'success'\)/);
    expect(store).toMatch(/await promptsApi\.duplicatePrompt\([\s\S]{0,200}showToast\(m\.pb_duplicated\(\), 'success'\)/);
    for (const [name, src] of [['Templates', templates], ['TemplateEditor', editor]] as const) {
      expect(src, name).not.toMatch(/pb_deleted\(\)|pb_duplicated\(\)/);
    }
  });

  it('a failed save stops the editor before "saved" and before the dirty reset', () => {
    expect(store).toMatch(/updatePrompt = useCallback\(async \(prompt: Prompt\): Promise<boolean> =>/);
    expect(store).toMatch(/if \(!activeWorkspaceId\) return false;/);
    expect(store).toMatch(/return true;\s*\} catch \(err: any\) \{\s*showToast\(err\.message \|\| m\.pb_update_failed\(\), 'error'\);\s*return false;/);
    const save = editor.slice(editor.indexOf('let savedId = id;'));
    expect(save).toMatch(/^let savedId = id;\s*if \(id\) \{\s*if \(!\(await updatePrompt\(saveData\)\)\) return;\s*\} else \{\s*const created = await addPrompt\(saveData\);\s*if \(!created\) return;/);
    expect(save.indexOf('return;')).toBeLessThan(save.indexOf("showToast(txt.ed_saved(), 'success')"));
    expect(save.indexOf('return;')).toBeLessThan(save.indexOf('setIsDirty(false)'));
  });

  it('the marketplace path in the same editor follows the same rule', () => {
    const data = code(read('store/data.tsx'));
    expect(data).toMatch(/updateLibraryTemplateAction = useCallback\(async \(template: LibraryTemplate\): Promise<boolean> =>/);
    expect(data).toMatch(/await libraryApi\.deleteLibraryTemplate\(id\);[\s\S]{0,120}showToast\(m\.pb_deleted\(\), 'success'\)/);
    expect(editor).toMatch(/if \(!\(await updateLibraryTemplate\(tpl\)\)\) return;/);
    expect(editor).toMatch(/const created = await addLibraryTemplate\(tpl\);\s*if \(!created\) return;/);
    expect(editor).not.toMatch(/ed_deleted/);
    expect(en.lib_copied).toBe('Playbook saved to workspace');
  });

  it('every store message is a key, and says playbook in both languages', () => {
    // store/data.tsx: only its playbook (marketplace) part — files and chats there are SQEM-607.
    const data = code(read('store/data.tsx'));
    const library = data.slice(data.indexOf('const addLibraryTemplate'), data.indexOf('const addWorkspaceFile'));
    for (const [f, src] of [['store/prompts.tsx', store], ['store/data.tsx (library)', library]] as const) {
      expect(src.length, f).toBeGreaterThan(500);
      expect(src, f).not.toMatch(/showToast\(\s*['"`]/);
      expect(src, f).not.toMatch(/showToast\([^)]*\|\| ['"`]/);
    }
    expect([en.pb_deleted, en.pb_duplicated]).toEqual(['Playbook deleted', 'Playbook duplicated']);
    expect([de.pb_deleted, de.pb_duplicated]).toEqual(['Playbook gelöscht', 'Playbook dupliziert']);
    for (const k of ['pb_create_failed', 'pb_update_failed', 'pb_delete_failed', 'pb_duplicate_failed'] as const) {
      expect(en[k], k).toMatch(/playbook$/);
    }
    expect(JSON.stringify(en)).not.toMatch(/"Prompt (deleted|duplicated|successfully saved)"/);
  });
});
