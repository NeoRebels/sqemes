import { describe, it, expect, vi } from 'vitest';

// library.ts imports the supabase client at module load — mock it (we only test the pure mapper).
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, storage: {} } }));

const { rowToLibraryTemplate } = await import('../../lib/api/library');

// SQEM-184 — the row→domain mapper behind the marketplace source split (Cloud + self-host public feed).
describe('rowToLibraryTemplate', () => {
  const base = {
    id: 'lt-1', kind: 'assistant', title: 'T', description: 'D', category: 'General',
    tags: ['a'], variables: [], steps: [], system_instruction: 'sys', brand_config: null,
    created_by: 'u1', usage_count: 3, published: true,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  };

  it('maps core columns', () => {
    const t = rowToLibraryTemplate(base as never);
    expect(t.id).toBe('lt-1');
    expect(t.kind).toBe('assistant');
    expect(t.usageCount).toBe(3);
    expect(t.systemInstruction).toBe('sys');
  });

  it('applies fallbacks for missing UGC columns', () => {
    const t = rowToLibraryTemplate(base as never);
    expect(t.score).toBe(0);
    expect(t.voteCount).toBe(0);
    expect(t.scanReasons).toEqual([]);
    expect(t.status).toBe('published');
    expect(t.source).toBe('cloud');
    expect(t.publisherName).toBeNull();
    expect(t.hasBundle).toBe(false);
  });

  it('sets hasBundle from a Cloud bundle_path', () => {
    expect(rowToLibraryTemplate({ ...base, bundle_path: 'ws/x/bundle.zip' } as never).hasBundle).toBe(true);
  });

  it('sets hasBundle from the self-host has_bundle flag (no path)', () => {
    expect(rowToLibraryTemplate({ ...base, has_bundle: true } as never).hasBundle).toBe(true);
  });

  it('reads publisherName from the nested join and source from the row', () => {
    const t = rowToLibraryTemplate({ ...base, source: 'self-host', marketplace_publishers: { display_name: 'ACME' } } as never);
    expect(t.source).toBe('self-host');
    expect(t.publisherName).toBe('ACME');
  });

  it('defaults kind to prompt when absent', () => {
    expect(rowToLibraryTemplate({ ...base, kind: null } as never).kind).toBe('prompt');
  });
});
