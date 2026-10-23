import { describe, it, expect } from 'vitest';
import { MCP_MAX_BODY_BYTES, declaredLength, readJsonCapped, tooLargeMessage } from '../../supabase/functions/_shared/requestBody';

/**
 * SQEM-530 — the MCP body ceiling. A tool call costs about ten times its body in worker memory
 * (measured 2026-10-19); past 256 MB the worker dies with 546 "Memory limit exceeded".
 */
const json = (o: unknown) => JSON.stringify(o);
const streamed = (text: string, chunk = 64 * 1024) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  // No Content-Length: a ReadableStream body is sent chunked, so the reader must count on its own.
  return new Request('http://x/', {
    method: 'POST',
    body: new ReadableStream({ pull(c) { if (offset >= bytes.length) return c.close(); c.enqueue(bytes.slice(offset, offset += chunk)); } }),
    // @ts-expect-error — required by Node for a streamed request body
    duplex: 'half',
  });
};

describe('SQEM-530 — readJsonCapped', () => {
  it('an ordinary call parses as before', async () => {
    const r = await readJsonCapped(new Request('http://x/', { method: 'POST', body: json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    expect(r).toEqual({ ok: true, v: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  });

  it('⛔ a declared length over the ceiling is refused without reading the body', async () => {
    let pulled = 0;
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-length': String(MCP_MAX_BODY_BYTES + 1) },
      body: new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }),
      // @ts-expect-error — see above
      duplex: 'half',
    });
    expect(await readJsonCapped(req)).toEqual({ ok: false, tooLarge: true, bytes: MCP_MAX_BODY_BYTES + 1 });
    expect(pulled).toBeLessThanOrEqual(1); // the stream's first eager pull at most, never the body
  });

  it('⛔ a body without a length is stopped as soon as it passes the ceiling', async () => {
    const r = await readJsonCapped(streamed(json({ content: 'x'.repeat(MCP_MAX_BODY_BYTES) })));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ tooLarge: true });
    expect((r as { bytes: number }).bytes).toBeGreaterThan(MCP_MAX_BODY_BYTES);
    expect((r as { bytes: number }).bytes).toBeLessThan(MCP_MAX_BODY_BYTES + 128 * 1024);
  });

  it('just under the ceiling still parses; broken JSON is a parse error, not "too large"', async () => {
    const content = 'x'.repeat(MCP_MAX_BODY_BYTES - 200);
    expect(await readJsonCapped(streamed(json({ content })))).toMatchObject({ ok: true });
    expect(await readJsonCapped(new Request('http://x/', { method: 'POST', body: '{nope' }))).toEqual({ ok: false, tooLarge: false });
  });

  it('declaredLength: a number, or null when absent or nonsense', () => {
    expect(declaredLength(new Headers({ 'content-length': '42' }))).toBe(42);
    expect(declaredLength(new Headers())).toBeNull();
    expect(declaredLength(new Headers({ 'content-length': 'abc' }))).toBeNull();
  });

  it('the refusal tells the client the way out', () => {
    const m = tooLargeMessage(30 * 1048576);
    expect(m).toContain('30.0 MB');
    expect(m).toContain('5.0 MB');
    expect(m).toMatch(/create_upload_url.*finalize_upload/);
  });
});

describe('SQEM-530 — mcp-server uses the ceiling', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (readFileSync('supabase/functions/mcp-server/index.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryActions.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryToolDefs.ts', 'utf8'));
  it('the body is read through readJsonCapped, never req.json()', () => {
    expect(src).toContain('readJsonCapped(req)');
    expect(src).not.toMatch(/\breq\.json\(\)/);
  });
  it('an oversized body is not forwarded to the home region first', () => {
    expect(src).toMatch(/if \(!oversized && shouldForward\(/);
  });
  it('upload_file names the limit, so an agent picks create_upload_url for big files', () => {
    expect(src).toContain('At most 5 MB per call; larger files go through create_upload_url.');
  });
});
