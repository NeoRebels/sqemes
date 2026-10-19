import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { errorMessage } from '../../lib/errorMessage';

/**
 * SQEM-529 — a failed bundle import takes back what it created. Until then only the files were
 * removed: an import that created its prompt and then failed on the persona (SQEM-525) left the
 * prompt in the workspace. The API modules are replaced by recorders; `fail` names the step
 * that throws, `refuse` the deletions that do.
 */
const log: string[] = [];
let fail = '';
let refuse = '';
let seq = 0;
// The shape Supabase really throws: a plain object, not an Error (see lib/errorMessage.ts).
const dbError = (message: string) => ({ message, code: '42501', details: null, hint: null });

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, storage: {} } }));
vi.mock('../../lib/api/files', () => ({
  uploadSkillFile: vi.fn(async (_ws: string, file: File) => {
    log.push(`upload ${file.name}`);
    return { id: `file-${file.name}`, name: file.name, storagePath: `ws/${file.name}`, mimeType: 'text/plain' };
  }),
  deleteWorkspaceFile: vi.fn(async (id: string) => {
    if (refuse.includes('file')) throw dbError('denied');
    log.push(`delete ${id}`);
  }),
  getWorkspaceFileSignedUrl: vi.fn(),
}));
vi.mock('../../lib/api/prompts', () => ({
  createPrompt: vi.fn(async (p: { title: string }) => {
    if (fail === `prompt ${p.title}`) throw dbError('prompt insert failed');
    const id = `prompt-${++seq}`;
    log.push(`create ${id}`);
    return { id };
  }),
  deletePrompt: vi.fn(async (id: string) => {
    if (refuse.includes('prompt')) throw dbError('denied');
    log.push(`delete ${id}`);
  }),
}));
vi.mock('../../lib/api/personas', () => ({
  createPersona: vi.fn(async (_ws: string, p: { title: string }) => {
    if (fail === 'persona') throw dbError('new row violates row-level security policy for table "personas"');
    const id = `persona-${++seq}`;
    log.push(`create ${id} ${p.title}`);
    return { id, routes: [] };
  }),
  setPersonaRoutes: vi.fn(async (id: string) => {
    if (fail === 'routes') throw dbError('routes insert failed');
    log.push(`routes ${id}`);
  }),
  deletePersona: vi.fn(async (id: string) => {
    if (refuse.includes('persona')) throw dbError('denied');
    log.push(`delete ${id}`);
  }),
}));

const { importBundle, BUNDLE_SCHEMA } = await import('../../lib/templateBundle');

async function bundle() {
  const zip = new JSZip();
  zip.file('files/ref.md', '# ref');
  const manifest = {
    schema: BUNDLE_SCHEMA,
    files: [{ ref: 'f1', name: 'ref.md', mimeType: 'text/markdown', sizeBytes: 5, path: 'files/ref.md' }],
    templates: [
      { ref: 't1', kind: 'prompt', title: 'Review', description: '', tag: null, content: 'x', contextFileRefs: ['f1'] },
      { ref: 't2', kind: 'skill', title: 'Policy', description: '', tag: null, content: 'y' },
    ],
    personas: [{ ref: 'p1', title: 'Reviewer', description: '', content: 'z', tags: [], routes: [{ templateRef: 't1', condition: 'always' }] }],
  };
  return { zip, manifest: manifest as never };
}

beforeEach(() => { log.length = 0; fail = ''; refuse = ''; seq = 0; });

describe('SQEM-529 — importBundle takes back what it created', () => {
  it('a clean import deletes nothing and sets the routes on the created persona', async () => {
    const { zip, manifest } = await bundle();
    const r = await importBundle(zip, manifest, 'ws', 'u');
    expect(r).toMatchObject({ templates: 2, personas: 1 });
    expect(log.filter(l => l.startsWith('delete'))).toEqual([]);
    expect(log).toContain('routes persona-3');
  });

  it('⛔ the persona fails (the SQEM-525 case): both playbooks and the file are removed, the cause comes through', async () => {
    fail = 'persona';
    const { zip, manifest } = await bundle();
    const err = await importBundle(zip, manifest, 'ws', 'u').catch(e => e);
    expect(errorMessage(err, '')).toMatch(/row-level security/);
    const deletes = log.filter(l => l.startsWith('delete'));
    expect(deletes).toEqual(['delete prompt-1', 'delete prompt-2', 'delete file-ref.md']);
  });

  it('⛔ the routes fail after the persona row exists: the persona goes too, and first', async () => {
    fail = 'routes';
    const { zip, manifest } = await bundle();
    await expect(importBundle(zip, manifest, 'ws', 'u')).rejects.toMatchObject({ message: 'routes insert failed' });
    expect(log.filter(l => l.startsWith('delete'))).toEqual(['delete persona-3', 'delete prompt-1', 'delete prompt-2', 'delete file-ref.md']);
  });

  it('only this run’s ids are deleted — a failure on the second playbook takes back the first and nothing else', async () => {
    fail = 'prompt Policy';
    const { zip, manifest } = await bundle();
    await expect(importBundle(zip, manifest, 'ws', 'u')).rejects.toMatchObject({ message: 'prompt insert failed' });
    expect(log.filter(l => l.startsWith('delete'))).toEqual(['delete prompt-1', 'delete file-ref.md']);
  });

  it('when the clean-up itself fails, the message keeps the cause and says what is left', async () => {
    fail = 'routes';
    refuse = 'prompt';
    const { zip, manifest } = await bundle();
    const err = await importBundle(zip, manifest, 'ws', 'u').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('routes insert failed Some imported items could not be removed: 2 playbooks.');
  });
});

describe('SQEM-529 — errorMessage', () => {
  it('reads the text of a Supabase error, which is a plain object and not an Error', () => {
    expect(dbError('boom') instanceof Error).toBe(false);
    expect(errorMessage(dbError('boom'), 'Import failed')).toBe('boom');
  });
  it('an Error, a string, and the fallback for anything without text', () => {
    expect(errorMessage(new Error('e'), 'f')).toBe('e');
    expect(errorMessage('s', 'f')).toBe('s');
    for (const e of [null, undefined, {}, { message: '' }, { message: 42 }, 7]) expect(errorMessage(e, 'f')).toBe('f');
  });
  it('the import pages no longer test for instanceof Error', async () => {
    const { readFileSync } = await import('node:fs');
    for (const page of ['pages/Templates.tsx', 'pages/Personas.tsx']) {
      const src = readFileSync(page, 'utf8');
      expect(src).not.toMatch(/instanceof Error \? e\.message : 'Import failed'|err\?\.message \|\| 'Import failed'/);
      expect(src).toContain("errorMessage(");
    }
  });
});
