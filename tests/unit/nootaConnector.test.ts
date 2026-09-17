import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-442 — Noota, the simplest shape there is: dynamic registration, nothing to paste.
 *
 * Measured 2026-09-17: `https://mcp.noota.io/mcp` answers 401 with protected-resource metadata,
 * the authorization server is `https://api.noota.io`, it offers `/api/v1/oauth2/register`, and it
 * publishes `scopes_supported: ['read']`.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const APPS = read('supabase/functions/_shared/connectorApps.ts');
const CARD = read('components/ConnectorsCard.tsx');
const ICON = read('components/icons/NootaIcon.tsx');

describe('SQEM-442 — Noota connector', () => {
  it('⛔ it declares its scope — the lesson SQEM-439 cost three rounds', () => {
    // Nifty's consent screen rejected a request with no `scope`, with an error naming neither the
    // parameter nor the cause. Noota publishes what it supports, so there is no excuse to guess.
    expect(APPS).toMatch(/noota: \{ provider: 'noota', name: 'Noota', mcpUrl: 'https:\/\/mcp\.noota\.io\/mcp', scopes: \['read'\] \}/);
  });

  it('nothing is pasted and nothing is configured', () => {
    // Dynamic registration: no clientIdEnv, and the tile is a plain redirect like Plaud's.
    expect(APPS).not.toMatch(/noota:[^}]*clientIdEnv/);
    expect(CARD).toMatch(/id: 'noota', provider: 'noota', name: 'Noota', description: 'Search your meetings & transcripts', auth: 'oauth', Icon: NootaIcon/);
  });

  it('the icon is the real mark, inline, in the brand colour', () => {
    expect(ICON).toMatch(/aria-label="Noota"/);
    expect(ICON).toMatch(/fill="#1F4ED8"/);
    // No external asset, no data URI — the rule from SQEM-431.
    expect(ICON).not.toMatch(/src=|url\(|data:image/);
  });
});
