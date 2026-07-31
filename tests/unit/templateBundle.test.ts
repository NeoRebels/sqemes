import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';

// templateBundle imports api/prompts + api/files (→ supabase) at load — mock the client.
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, storage: {} } }));

const { readBundle, BUNDLE_SCHEMA } = await import('../../lib/templateBundle');

// SQEM-184 — readBundle's zip-bomb / corrupt-bundle validation gates.
async function zipToFile(build: (z: JSZip) => void): Promise<File> {
  const z = new JSZip();
  build(z);
  const blob = await z.generateAsync({ type: 'blob' });
  return new File([blob], 'bundle.sqemes.zip');
}
const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: BUNDLE_SCHEMA, templates: [], skills: [], files: [], ...over });

describe('readBundle', () => {
  it('accepts a valid bundle', async () => {
    const f = await zipToFile(z => z.file('manifest.json', manifest({ files: [{ name: 'a.txt', sizeBytes: 10 }] })));
    const { manifest: m } = await readBundle(f);
    expect(m.schema).toBe(BUNDLE_SCHEMA);
  });

  it('rejects a zip with no manifest.json', async () => {
    const f = await zipToFile(z => z.file('nope.txt', 'x'));
    await expect(readBundle(f)).rejects.toThrow(/manifest\.json missing/i);
  });

  it('rejects an unsupported schema', async () => {
    const f = await zipToFile(z => z.file('manifest.json', manifest({ schema: 'sqemes-bundle/v99' })));
    await expect(readBundle(f)).rejects.toThrow(/unsupported bundle version/i);
  });

  it('rejects too many files (zip-bomb guard)', async () => {
    const files = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.txt`, sizeBytes: 1 }));
    const f = await zipToFile(z => z.file('manifest.json', manifest({ files })));
    await expect(readBundle(f)).rejects.toThrow(/too many files/i);
  });

  it('rejects a bundle whose declared size exceeds the limit', async () => {
    const files = [{ name: 'big.bin', sizeBytes: 201 * 1024 * 1024 }];
    const f = await zipToFile(z => z.file('manifest.json', manifest({ files })));
    await expect(readBundle(f)).rejects.toThrow(/size limit/i);
  });
});
