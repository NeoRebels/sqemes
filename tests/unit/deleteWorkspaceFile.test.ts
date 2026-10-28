import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-515 step B — on Cloud no client reads `workspace-files` objects, and Storage's remove() needs
 * that read (without it: 200, `[]`, nothing deleted — measured 2026-10-17). So the browser deletes
 * through `delete-workspace-file`, and the function proves the object went. Self-host keeps the
 * browser path (its read policy stays; the Cloud migration is pruned from the export).
 * Exported with the self-host build — the prune check lives in the pruned storageLimitCloud.test.ts.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments (comment-stripper-order lesson).
const code = (s: string) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const bodyOf = (src: string, name: string) => {
  const i = src.indexOf(`function ${name}`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = src.indexOf('\nexport ', i + 10);
  const k = src.indexOf('\nasync function ', i + 10);
  const ends = [j, k].filter(n => n > 0);
  return src.slice(i, ends.length ? Math.min(...ends) : undefined);
};

describe('lib/api/files.ts — the browser never touches storage objects on Cloud except to upload', () => {
  const src = code(read('lib/api/files.ts'));
  it('deleting a file goes through the function on Cloud; the browser path is self-host only', () => {
    const del = bodyOf(src, 'deleteWorkspaceFile');
    expect(del).toMatch(/if \(!IS_SELF_HOSTED\) \{\s*const res = await callDeleteFunction\(\{ fileId: id \}\)/);
    expect(del.indexOf('callDeleteFunction')).toBeLessThan(del.indexOf(".remove(["));
  });
  it('the clean-up after a failed upload goes through the function on Cloud', () => {
    const orphan = bodyOf(src, 'removeOrphanObject');
    expect(orphan).toMatch(/if \(IS_SELF_HOSTED\) \{[\s\S]*\.remove\(\[storagePath\]\)[\s\S]*return;\s*\}\s*await callDeleteFunction\(\{ orphanPath: storagePath \}\)/);
    expect(bodyOf(src, 'storeWorkspaceFile')).toMatch(/await removeOrphanObject\(storagePath\)/);
  });
  it('⛔ every remove / download / createSignedUrl on workspace-files sits in a self-host branch', () => {
    const calls = [...src.matchAll(/\.(remove|download|createSignedUrl|createSignedUrls)\(/g)].map(m => m.index!);
    for (const at of calls) {
      const before = src.slice(Math.max(0, at - 400), at);
      expect(before, `a storage call without IS_SELF_HOSTED in front of it near ${src.slice(at, at + 60)}`).toMatch(/IS_SELF_HOSTED/);
    }
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('delete-workspace-file — rules where they were, and proof that the object went', () => {
  const fn = code(read('supabase/functions/delete-workspace-file/index.ts'));
  it('deletes the ROW with the caller\'s token (RLS + SQEM-234), and only then the object', () => {
    expect(fn).toMatch(/await asUser\.from\('workspace_files'\)\.delete\(\)\.eq\('id', fileId\)/);
    expect(fn.indexOf("asUser.from('workspace_files').delete()")).toBeLessThan(fn.indexOf('removeObject(row.storage_path)'));
  });
  it('an empty remove() result counts as a failure, never as success', () => {
    expect(fn).toMatch(/\(data \?\? \[\]\)\.some\(\(o: \{ name\?: string \}\) => o\.name === path\)/);
  });
  it('a refused delete answers like a missing file (no existence oracle)', () => {
    // SQEM-612 — the same message as a missing row, in whichever language: no oracle in either.
    expect(fn).toMatch(/if \(still\) return json\(\{ error: txt\.srv_not_found\(\{\}, \{ locale \}\) \}, 404\)/);
    expect(fn).toMatch(/if \(!row\) return json\(\{ error: txt\.srv_not_found\(\{\}, \{ locale \}\) \}, 404\)/);
  });
  it('orphans only through the database rule', () => {
    expect(fn).toMatch(/admin\.rpc\('can_delete_orphan_object', \{ p_path: path, p_uid: user\.id \}\)/);
  });
  it('is registered without gateway JWT checks, like sign-file-url (it verifies the token itself)', () => {
    expect(read('supabase/config.toml')).toMatch(/\[functions\.delete-workspace-file\]\nverify_jwt = false/);
    expect(fn).toMatch(/admin\.auth\.getUser\(token\)/);
  });
});
