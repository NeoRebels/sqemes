import { describe, it, expect } from 'vitest';
import { PLANS, VAT_NOTE } from '../../constants';
import { MCP_CLIENTS } from '../../lib/mcpClients';
import { OAUTH_APPS, GOOGLE_PENDING_REVIEW, GOOGLE_TESTING_NOTE, TILE_TEXT_DE, tileText } from '../../components/connectorAppTiles';
import { planFeature, planTagline, planMonthly, planMonthlyAmount, mcpClientText } from '../../lib/labels';
import { en, de } from './i18nText';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-609 — three English sources keep their values (constants.ts, lib/mcpClients.ts, the connector
 * tile list) and are translated at render through maps in lib/labels.ts, keyed by the English text.
 *
 * ⛔ The failure this guards against is silent: a line added to a source without a map entry just
 * shows in English in a German app, and an English message that drifts from its source shows a
 * different sentence than the constant says. Both fail here instead.
 */
const mapped = (text: string, f: (t: string) => string) => f(text) === text && !Object.values(en).includes(text) ? null : f(text);

describe('SQEM-609 — plan texts', () => {
  it('every feature line and tagline has a message whose English is exactly the constant', () => {
    for (const [tier, plan] of Object.entries(PLANS)) {
      for (const feature of plan.features) {
        expect(mapped(feature, planFeature), `${tier}: ${feature}`).toBe(feature); // in English the map returns the same text
      }
      expect(planTagline(tier, '—'), tier).toBe(plan.tagline);
    }
  });

  it('the VAT note in the UI is the one the Terms promise (VAT_NOTE)', () => {
    expect(en.stl_vat).toBe(VAT_NOTE);
  });

  it('the price shown is the price in constants, in the app format', () => {
    for (const plan of Object.values(PLANS)) {
      expect(planMonthly(planMonthlyAmount(plan.price))).toBe(plan.price); // '€12/mo' round-trips in English
    }
  });
});

describe('SQEM-609 — MCP client guides', () => {
  it('every step and note has a message whose English is exactly the guide', () => {
    for (const c of MCP_CLIENTS) {
      for (const text of [...c.steps, ...(c.note ? [c.note] : [])]) {
        expect(mapped(text, mcpClientText), `${c.id}: ${text.slice(0, 40)}`).toBe(text);
      }
    }
    expect(mcpClientText('Other')).toBe('Other');
    expect(en.mcpc_other).toBe('Other');
  });
});

describe('SQEM-609/615 — connector tiles (Cloud list)', () => {
  // OAuth terms and sample values that stay as they are in German too.
  const AS_IS = new Set(['Client ID', 'Client Secret', 'Client secret', 'example.com', 'ghp_… / github_pat_…']);
  const tileTexts = () => {
    const texts = [GOOGLE_PENDING_REVIEW, GOOGLE_TESTING_NOTE];
    for (const app of OAUTH_APPS) {
      const a = app as Record<string, unknown>;
      for (const field of ['description', 'unavailable', 'help', 'tokenLabel', 'hostLabel', 'placeholder', 'secretLabel']) {
        if (typeof a[field] === 'string' && a[field]) texts.push(a[field] as string);
      }
    }
    // An empty constant is "no text" — the self-host stub of the tile file exports '' (SQEM-614).
    return texts.filter(t => t && !AS_IS.has(t));
  };

  it('every description, help, label and status line has a German text in the tile file', () => {
    for (const text of tileTexts()) {
      expect(TILE_TEXT_DE[text], text.slice(0, 50)).toBeTruthy();
      expect(TILE_TEXT_DE[text], text.slice(0, 50)).not.toBe(text);
    }
    expect(tileText('Read your documents')).toBe('Read your documents'); // English: the tile's own text
  });

  it('⛔ no tile text in the message catalogue — it ships whole with the self-host export (SQEM-615)', () => {
    const catalogue = new Set([...Object.values(en), ...Object.values(de)].filter((v): v is string => typeof v === 'string'));
    for (const text of tileTexts()) {
      expect(catalogue.has(text), text.slice(0, 50)).toBe(false);
      // German sentences too; a short generic word ("Shop-Domain") may legitimately exist elsewhere.
      if (TILE_TEXT_DE[text].length >= 30) expect(catalogue.has(TILE_TEXT_DE[text]), TILE_TEXT_DE[text].slice(0, 50)).toBe(false);
    }
    expect(Object.keys(en).filter(k => k.startsWith('ct_'))).toEqual([]);
  });

  it('lib/labels.ts does not reach into the tile file (the export replaces it with a stub)', () => {
    const labels = readFileSync(resolve(__dirname, '../../lib/labels.ts'), 'utf8');
    expect(labels).not.toMatch(/connectorAppTiles|connectorText|CONNECTOR_TEXT/);
  });
});
