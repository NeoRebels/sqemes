import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-440 — Notion moves from our REST shim to its own MCP server.
 *
 * ⚠️ This is an exchange, not an upgrade: the shim offered tools we wrote, Notion's server offers
 * Notion's. That is the benefit (they evolve with Notion, we maintain nothing) and the cost (names
 * and shape change) in the same sentence.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const APPS = read('supabase/functions/_shared/connectorApps.ts');
const CARD = read('components/ConnectorsCard.tsx');
const SQL = read('supabase/migrations/20260917180000_sqem440_notion_official_mcp.sql');

describe('SQEM-440 — Notion on its own server', () => {
  it('Notion is an MCP-OAuth app and no longer a token-paste one', () => {
    expect(APPS).toMatch(/notion: \{ provider: 'notion', name: 'Notion', mcpUrl: 'https:\/\/mcp\.notion\.com\/mcp' \}/);
    // Gone from TOKEN_APPS, and with it the pasted integration token.
    expect(APPS).not.toMatch(/notion:\s*\{ provider: 'notion',\s*name: 'Notion',\s*mcpUrl: `\$\{PUBLIC_API_URL\}/);
  });

  it('the tile is a plain redirect — nothing to paste', () => {
    expect(CARD).toMatch(/id: 'notion', provider: 'notion', name: 'Notion', description: 'Search pages & databases', auth: 'oauth', Icon: NotionIcon/);
    expect(CARD).not.toMatch(/Internal integration token/);
    expect(CARD).not.toMatch(/notion\.so\/my-integrations/);
  });

  it('⛔ the shim is gone — from the tree AND from config.toml', () => {
    expect(existsSync(resolve(ROOT, 'supabase/functions/mcp-notion'))).toBe(false);
    // ⚠️ Deleting the directory alone turned the Supabase preview red with "failed to bundle
    // function": `config.toml` still declared it, so the deploy tried to build a function whose
    // source no longer existed. The two have to be removed together.
    expect(read('supabase/config.toml')).not.toMatch(/\[functions\.mcp-notion\]/);
  });

  it('⚠️ every declared function still has a directory', () => {
    // The general form of the trap above — a stale `config.toml` entry fails the deploy, not the
    // build, so nothing local catches it.
    const declared = [...read('supabase/config.toml').matchAll(/^\[functions\.([\w-]+)\]/gm)].map(m => m[1]);
    expect(declared.length).toBeGreaterThan(5);

    // ⛔ **This rule is OURS, not the public repo's — and asserting it there turned the export red.**
    // The export prunes Cloud-only functions (`marketplace-submit`, SQEM-182) but keeps `config.toml`
    // whole, so one entry is deliberately stale there. That is harmless: a self-host stack serves
    // edge functions from a mounted directory (`selfhost/docker-compose.yml` → `./volumes/functions`)
    // and nothing in `selfhost/` or `scripts/` reads `config.toml` at all. The trap this test guards
    // — `supabase functions deploy` refusing to bundle a function whose source is gone — exists only
    // on the path we deploy with. Same treatment as the pruned reader in `assistantsBecomeSkills`
    // (SQEM-411): a file the export removes must never fail the public repo's tests.
    if (!existsSync(resolve(ROOT, 'scripts/build-public-export.sh'))) return;

    for (const fn of declared) {
      expect(existsSync(resolve(ROOT, 'supabase/functions', fn)), `functions/${fn} is declared in config.toml`).toBe(true);
    }
  });

  it('⛔ the cleanup is narrow, and says how many rows it removed', () => {
    // Only OUR shim's rows. A connector somebody added by hand against a different Notion endpoint is
    // not ours to delete, and neither is anything the new entry creates (mcp.notion.com).
    expect(SQL).toMatch(/where provider = 'notion'\s*\n\s*and mcp_url like '%\/functions\/v1\/mcp-notion%'/);
    expect(SQL).toMatch(/get diagnostics removed = row_count/);
    expect(SQL).toMatch(/raise notice 'SQEM-440: removed % shim-based Notion connector\(s\)/);
  });

  it('⚠️ the reason for deleting rather than keeping them is written down', () => {
    // They point at a function that no longer exists and hold the wrong kind of token: kept, they
    // would look connected and fail on every call.
    expect(SQL).toMatch(/would give people a connector that looks connected and\n-- fails on every call/);
  });
});
