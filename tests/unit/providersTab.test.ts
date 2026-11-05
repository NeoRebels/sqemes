import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { en, de } from './i18nText';

/**
 * SQEM-618 — the AI provider keys and the web search key have their own Settings tab, behind the same
 * right as before (`api-keys:manage`: admins and editors; members never, SQEM-328). Every link that
 * means "add an AI provider key" opens it; the MCP links still open API & MCP.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const settings = read('pages/Settings.tsx');
const tab = settings.slice(settings.indexOf('{/* --- AI providers Tab --- */}'), settings.indexOf("{activeTab === 'connectors' && ("));

describe('SQEM-618 — the AI providers tab', () => {
  it('holds the provider keys and the web search key, each once in the page', () => {
    expect(tab).toContain("{activeTab === 'providers' && can(currentUser, workspace, 'api-keys:manage') && (");
    expect(tab).toContain('m.sta_provider_title()');
    expect(tab).toContain('SEARCH = {');
    expect(settings.match(/m\.sta_provider_title\(\)/g)).toHaveLength(1);
    expect(settings.match(/SEARCH = \{/g)).toHaveLength(1);
  });

  // SQEM-631 (2026-11-03) — keys first, then the model they make choosable, then web search.
  it('SQEM-631 — the default AI model sits between the provider keys and web search, and not in General', () => {
    const keys = tab.indexOf('m.sta_provider_title()');
    const model = tab.indexOf('<AuthoringModelCard');
    const search = tab.indexOf('SEARCH = {');
    expect(keys).toBeGreaterThan(-1);
    expect(model).toBeGreaterThan(keys);
    expect(search).toBeGreaterThan(model);
    expect(settings.match(/<AuthoringModelCard/g)).toHaveLength(1);
    const general = settings.slice(settings.indexOf('{/* --- General Tab --- */}'), settings.indexOf('{/* --- Security Tab --- */}'));
    expect(general).not.toContain('<AuthoringModelCard');
    // The card's link said "in the API tab" — wrong since SQEM-618, and the keys now stand right above it.
    expect([en.am_add_key, de.am_add_key]).toEqual(['Add a provider key above ↑', 'Anbieter-Schlüssel oben hinzufügen ↑']);
    for (const k of ['aierr_alternative', 'wu_pdf_provider'] as const) {
      expect(en[k], k).toContain('Settings → AI providers → Default AI model');
      expect(de[k], k).toContain('Einstellungen → KI-Anbieter → Standard-KI-Modell');
    }
  });

  it('⛔ is shown only with api-keys:manage, and a deep link without it lands on General', () => {
    expect(settings).toContain("if (tab.id === 'providers' && !can(currentUser, workspace, 'api-keys:manage')) return false;");
    expect(settings).toContain("(requestedTab === 'providers' && !can(currentUser, workspace, 'api-keys:manage'))");
    expect(settings).toContain("(urlTab === 'providers' && !can(currentUser, workspace, 'api-keys:manage'))");
    // Members still get only these three; the providers tab is not among them.
    expect(settings).toContain("return tab.id === 'profile' || tab.id === 'connectors' || tab.id === 'api';");
  });

  it('every "add a provider key" link opens it; the MCP link stays on API & MCP', () => {
    const overview = read('pages/Overview.tsx');
    expect(overview.match(/initialTab: 'providers'/g)).toHaveLength(2);
    expect(overview.match(/initialTab: 'api'/g)).toHaveLength(1);
    // SQEM-631 — the default-model card sits in this tab now, so its "add a key" scrolls up to the keys.
    expect(settings).toContain("onOpenApiKeys={() => document.getElementById('provider-keys-title')?.scrollIntoView(");
    expect(read('components/SetupWizard.tsx').match(/state=\{\{ initialTab: 'providers' \}\}/g)).toHaveLength(3);
  });

  it('no text sends anyone to the old place for a provider or search key', () => {
    for (const k of ['chat_web_needs_key', 'server_web_allowance', 'server_web_not_setup', 'sw_key_optional_body', 'srv_no_key'] as const) {
      expect(en[k], k).toContain('Settings → AI providers');
      expect(de[k], k).toContain('Einstellungen → KI-Anbieter');
    }
    expect([en.st_tab_providers, de.st_tab_providers]).toEqual(['AI providers', 'KI-Anbieter']);
  });
});
