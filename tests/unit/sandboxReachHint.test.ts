import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sandboxReachHint } from '../../supabase/functions/_shared/fileLinks';
import { MCP_CLIENTS } from '../../lib/mcpClients';

/**
 * SQEM-622 — a link we hand out fails in Claude's code sandbox when the instance's domain is not
 * allowed there; nothing reaches us, so the agent must be able to tell the person from the result.
 */
describe('SQEM-622 sandbox reach hint', () => {
  it('names the host of the link itself — Cloud or a self-hosted instance', () => {
    expect(sandboxReachHint('https://api.sqemes.com/storage/v1/object/upload/sign/x?token=t')).toContain('api.sqemes.com is not among its allowed domains');
    expect(sandboxReachHint('https://sqemes.example.org/storage/v1/x')).toContain('sqemes.example.org');
  });

  it('stays neutral when the link is not a URL', () => {
    expect(sandboxReachHint('')).toContain('this server is not among its allowed domains');
  });

  // SQEM-626 — one client's settings path misled another (Claude Code on the web, measured 2026-11-02).
  it('names the failure kinds and the fix without naming a client, and offers the Files page', () => {
    const h = sandboxReachHint('https://api.sqemes.com/x');
    expect(h).toMatch(/DNS failure, proxy 403, connection reset/);
    expect(h).toContain('allow api.sqemes.com');
    expect(h).toContain('Files page');
    expect(h).not.toMatch(/Claude|ChatGPT|Codex|Capabilities|curl exit/);
  });

  it('stays short — it rides on every link result', () => {
    expect(sandboxReachHint('https://h/x').length - 'h'.length).toBeLessThanOrEqual(300);
  });

  it('⛔ writes no product URL into the shipped hint (self-host)', () => {
    const src = readFileSync('supabase/functions/_shared/fileLinks.ts', 'utf8');
    const fn = src.slice(src.indexOf('export function sandboxReachHint'));
    expect(fn).not.toContain('sqemes.com');
  });

  it('rides on all four places a link or a failed upload is reported', () => {
    const src = readFileSync('supabase/functions/_shared/libraryActions.ts', 'utf8');
    expect(src.match(/sandboxReachHint\(/g)?.length).toBe(4);
  });

  // SQEM-629 — every client measured in SQEM-626/627 has the files box; local clients need nothing.
  it('the setup guide shows the files box for the four sandboxed clients, and only for them', () => {
    expect(MCP_CLIENTS.filter(c => c.files).map(c => c.id)).toEqual(['claude', 'chatgpt', 'claude-code', 'codex']);
    expect(MCP_CLIENTS.filter(c => c.files?.showDomain).map(c => c.id)).toEqual(['claude', 'claude-code', 'codex']);
  });

  it('each files text is translated, and no note repeats it', () => {
    const de = JSON.parse(readFileSync('messages/de.json', 'utf8')) as Record<string, string>;
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Record<string, string>;
    for (const c of MCP_CLIENTS.filter(x => x.files)) {
      const key = Object.keys(en).find(k => en[k] === c.files!.body);
      expect(key, c.id).toBeDefined();
      expect(de[key!], c.id).toBeTruthy();
      expect(de[key!], c.id).not.toBe(en[key!]);
      expect(c.note ?? '', c.id).not.toMatch(/files from skills|Files page|allowlist|Allowed domains|network access/i);
    }
  });
});
