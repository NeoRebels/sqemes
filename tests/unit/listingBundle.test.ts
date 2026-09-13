import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { listingToBundle } from '../../lib/listingBundle';
import { BUNDLE_SCHEMA } from '../../lib/bundleFormat';
import type { LibraryTemplate } from '../../types';

const listing = (over: Partial<LibraryTemplate> = {}) => ({
  title: 'Weekly report', description: 'A weekly status report', kind: 'prompt',
  content: '', steps: [], variables: [], ...over,
} as unknown as LibraryTemplate);

async function manifestOf(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return JSON.parse(await zip.file('manifest.json')!.async('string'));
}

// SQEM-302 — a listing leaves as the Sqemes bundle, whatever kind it is.
describe('listingToBundle', () => {
  // ⛔ The stored bundle was written by the exporter. Re-packing it could only lose fidelity, so a
  // user-contributed listing is handed over byte-for-byte.
  it('passes a stored bundle through untouched', async () => {
    const stored = new Blob(['not really a zip'], { type: 'application/zip' });
    expect(await listingToBundle(listing(), stored)).toBe(stored);
  });

  // 21 of the 22 listings on production are curated and carry no bundle. Without this they would
  // have lost the button entirely.
  it('assembles one for a curated listing that has none', async () => {
    const m = await manifestOf(await listingToBundle(listing({ content: 'Write a status report.' }), null));
    expect(m.schema).toBe(BUNDLE_SCHEMA);
    expect(m.templates).toHaveLength(1);
    expect(m.templates[0].title).toBe('Weekly report');
    expect(m.templates[0].content).toBe('Write a status report.');
  });

  // ⚠️ Curated rows predate the `content` column and keep their text in the first step. Reading only
  // `content` would produce a download that succeeds and hands over an empty template — a failure
  // that looks like success.
  it('falls back to the first step when there is no content column', async () => {
    const m = await manifestOf(await listingToBundle(
      listing({ content: undefined, steps: [{ content: 'From the step' }] as unknown as LibraryTemplate['steps'] }), null,
    ));
    expect(m.templates[0].content).toBe('From the step');
  });

  it('prefers content over the step when both exist', async () => {
    const m = await manifestOf(await listingToBundle(
      listing({ content: 'From content', steps: [{ content: 'From the step' }] as unknown as LibraryTemplate['steps'] }), null,
    ));
    expect(m.templates[0].content).toBe('From content');
  });

  // The restriction this ticket removed: the old download was an Agent Skill folder and therefore
  // skills only. Both kinds must survive the trip.
  it.each(['prompt', 'skill'] as const)('carries a %s', async kind => {
    const m = await manifestOf(await listingToBundle(listing({ kind }), null));
    expect(m.templates[0].kind).toBe(kind);
  });

  it('keeps a prompt’s variables, and writes no legacy field', async () => {
    const vars = [{ name: 'topic', label: 'Topic', type: 'text' }];
    const m = await manifestOf(await listingToBundle(listing({ kind: 'prompt', variables: vars as never }), null));
    expect(m.templates[0].variables).toEqual(vars);
    // SQEM-390 — `systemInstruction` is read-only legacy in the format; the writer never emits it.
    expect(m.templates[0]).not.toHaveProperty('systemInstruction');
    expect(m.templates[0]).not.toHaveProperty('brandConfig');
  });
});
