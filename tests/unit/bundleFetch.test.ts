import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import type { Prompt, WorkspaceFile } from '../../types';

/**
 * SQEM-521 — building a bundle fetches its files together, not one after another. Measured on staging
 * on 2026-10-18 before the change: 60 files = 60 `sign-file-url` calls + 60 downloads in a row, 41 of
 * the 46 s a submission took. This runs the real `buildBundle` and the real sign queue
 * (`lib/api/files.ts`) against a stubbed network.
 */
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), storage: {}, auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));
const { buildBundle, FETCH_CONCURRENCY } = await import('../../lib/templateBundle');

const WS = '49dc0b03-aa56-4157-8356-8959707571d0';
const file = (i: number): WorkspaceFile => ({
  id: `id${i}`, name: `file${i}.md`, mimeType: 'text/markdown', sizeBytes: 1, storagePath: `${WS}/p${i}.md`,
} as unknown as WorkspaceFile);
const tpl = (ids: string[], i: number) => ({ id: `t${i}`, kind: 'skill', title: `T${i}`, description: '', content: 'c', variables: [], contextFileIds: ids } as unknown as Prompt);

let signCalls = 0, active = 0, maxActive = 0, downloadsBeforeLastSign = 0;
beforeEach(() => {
  signCalls = 0; active = 0; maxActive = 0; downloadsBeforeLastSign = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('sign-file-url')) {
      signCalls++;
      const { paths } = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ urls: Object.fromEntries(paths.map((p: string) => [p, `https://dl.test/${p}`])) }));
    }
    if (signCalls === 0) downloadsBeforeLastSign++;
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 5));
    active--;
    // A plain object, not a Response: under jsdom on CI's Node a Response's Blob is not the Blob JSZip
    // accepts ("parameter 1 is not of type 'Blob'"); green locally, red in CI.
    if (String(url).endsWith('p3.md')) return { ok: false, status: 404, blob: async () => new Blob(['gone']) };
    return { ok: true, status: 200, blob: async () => new Blob([`bytes of ${String(url).split('/').pop()}`]) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('SQEM-521 — files are fetched together', () => {
  const files = Array.from({ length: 12 }, (_, i) => file(i));

  it('one sign-file-url call for all files, then at most FETCH_CONCURRENCY downloads at a time', async () => {
    await buildBundle([tpl(files.map(f => f.id), 1)], files);
    expect(signCalls).toBe(1);
    expect(downloadsBeforeLastSign).toBe(0);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(FETCH_CONCURRENCY);
  });

  it('the manifest is what the sequential version wrote: refs in traversal order, a failed file skipped, shared files once', async () => {
    const { manifest, blob } = await buildBundle([tpl(['id5', 'id3', 'id1'], 1), tpl(['id1', 'id2', 'missing'], 2)], files);
    expect(manifest.files.map(f => [f.ref, f.name])).toEqual([['f1', 'file5.md'], ['f2', 'file1.md'], ['f3', 'file2.md']]);
    expect(manifest.templates.map(t => t.contextFileRefs)).toEqual([['f1', 'f2'], ['f2', 'f3']]);
    const zip = await JSZip.loadAsync(blob);
    expect(await zip.file('files/f1__file5.md')!.async('string')).toBe('bytes of p5.md');
  });
});
