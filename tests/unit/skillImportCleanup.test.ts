import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SQEM-514 — an aborted skill import leaves nothing behind. Both browser import paths (an Agent Skill
 * ZIP and a `.sqemes.zip` bundle) used to upload file by file and stop at the first failure, leaving
 * the files before it in the workspace with no skill pointing at them. They now upload every file as a
 * SKILL file (any type, decided from the bytes) and remove exactly the files this run created.
 */
const uploaded: string[] = [];
const removed: string[] = [];
let failOn = '';

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, storage: {} } }));
vi.mock('../../lib/api/files', () => ({
  uploadSkillFile: vi.fn(async (_ws: string, file: File) => {
    if (failOn && file.name.endsWith(failOn)) throw new Error('Storage limit reached');
    uploaded.push(file.name);
    return { id: `id-${file.name}`, name: file.name, storagePath: `ws/${file.name}`, mimeType: 'text/plain' };
  }),
  uploadWorkspaceFile: vi.fn(async () => { throw new Error('skill imports must not use uploadWorkspaceFile'); }),
  deleteWorkspaceFile: vi.fn(async (id: string) => { removed.push(id); }),
  getWorkspaceFileSignedUrl: vi.fn(),
}));
vi.mock('../../lib/api/prompts', () => ({ createPrompt: vi.fn(async () => ({ id: 'skill-1' })) }));

const { importSkillBundle } = await import('../../lib/skillBundleIo');

const bundle = (names: string[]) => ({
  title: 'Docx', description: '', content: '# body',
  files: names.map(name => ({ name, blob: new Blob(['x']), mimeType: '' })),
});

beforeEach(() => { uploaded.length = 0; removed.length = 0; failOn = ''; });

describe('Agent Skill ZIP import (importSkillBundle)', () => {
  it('uploads every file as a skill file, whatever the archive said its type was', async () => {
    const r = await importSkillBundle(bundle(['SKILL-ref.md', 'assets/Inter.ttf', 'scripts/pack.py']), 'ws', 'u');
    expect(r.files).toHaveLength(3);
    expect(uploaded).toEqual(['docx/SKILL-ref.md', 'docx/assets/Inter.ttf', 'docx/scripts/pack.py']);
    expect(removed).toEqual([]);
  });

  it('⛔ a failure part-way removes exactly the files this run created, then reports the failure', async () => {
    failOn = 'third.md';
    await expect(importSkillBundle(bundle(['first.md', 'second.png', 'third.md', 'fourth.md']), 'ws', 'u'))
      .rejects.toThrow('Storage limit reached');
    expect(removed.sort()).toEqual(['id-docx/first.md', 'id-docx/second.png']);
  });
});
