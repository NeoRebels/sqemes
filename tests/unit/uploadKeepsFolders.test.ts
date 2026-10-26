import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uploadedFileName } from '../../supabase/functions/_shared/skillPaths';
import { safeStorageFileName } from '../../lib/storageKey';

/**
 * SQEM-592 — a binary upload over MCP keeps its folders.
 *
 * create_upload_url defuses `/` in the storage key (SQEM-111/237), and finalize_upload used to name the
 * row after that key: `design-system/fonts/Lato.woff2` came back as `design-system_fonts_Lato.woff2`,
 * and a downloaded skill's fonts.css no longer found its fonts (SQEM-236 says the visible name is never
 * defused). The announced name now crosses the PUT in `pending_uploads`.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments: a block-first stripper can swallow code after a glob in a line comment.
const code = (src: string) => src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const SRC = code(read('supabase/functions/_shared/libraryActions.ts'));
const handler = (name: string) => {
  const start = SRC.indexOf(`if (toolName === '${name}')`);
  const end = SRC.indexOf("if (toolName === '", start + 10);
  return SRC.slice(start, end);
};

describe('uploadedFileName', () => {
  const PATH = 'design-system/fonts/Lato-400-normal-latin.woff2';

  it('keeps the announced path, not the defused storage key', () => {
    expect(uploadedFileName(PATH, safeStorageFileName(PATH))).toBe(PATH);
  });

  it('falls back to the storage key only when nothing was announced (URL issued before SQEM-592)', () => {
    expect(uploadedFileName(null, 'design-system_fonts_x.woff2')).toBe('design-system_fonts_x.woff2');
    expect(uploadedFileName(undefined, 'a.png')).toBe('a.png');
    expect(uploadedFileName('  ', 'a.png')).toBe('a.png');
  });
});

describe('create_upload_url → finalize_upload carries the name', () => {
  it('create_upload_url records the name it was given, unsanitised, for this workspace', () => {
    expect(handler('create_upload_url')).toMatch(
      /\.from\('pending_uploads'\)\s*\.insert\(\{ file_id: fileId, workspace_id: workspaceId, name: fileName \}\)/,
    );
  });

  it('⛔ finalize_upload reads it scoped to the workspace and names the row with it — never obj.name directly', () => {
    const fin = handler('finalize_upload');
    expect(fin).toMatch(/\.from\('pending_uploads'\)\s*\.select\('name'\)\s*\.eq\('file_id', fileId\)\s*\.eq\('workspace_id', workspaceId\)/);
    expect(fin).toMatch(/const fileName = uploadedFileName\(pending\?\.name, obj\.name\)/);
    expect(fin).toMatch(/name:\s+fileName,/);
    expect(fin).not.toMatch(/name:\s+obj\.name/);
  });

  it('⛔ the cleanup never splices the caller-supplied fileId into a PostgREST .or() filter', () => {
    expect(handler('finalize_upload')).not.toMatch(/\.or\(/);
  });

  it('the tool description tells clients a relative path is kept', () => {
    expect(read('supabase/functions/_shared/libraryToolDefs.ts')).toMatch(/Filename with extension[^']*RELATIVE PATH and is stored exactly as given/);
  });
});

describe('the migration', () => {
  const sql = read('supabase/migrations/20261026140000_sqem592_pending_uploads.sql');
  it('⛔ is service-role only: RLS on, no policy, no grant to clients', () => {
    expect(sql).toMatch(/alter table public\.pending_uploads enable row level security/);
    expect(sql).toMatch(/revoke all on public\.pending_uploads from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/\bgrant\b/);
  });
});
