import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { composePersona } from '../../supabase/functions/_shared/libraryQueries';
import { connectorServiceKey, parsePersonaConnectors, resolvePersonaConnectors } from '../../supabase/functions/_shared/connectorService';
import { en, de } from './i18nText';

/**
 * SQEM-639/641 — a persona carries the connector SERVICES its role works with. In sqemes Chat each
 * person's own connection (or a shared one) is switched on; a missing one is said in the chat. Over MCP
 * the persona only recommends them. Decided 2026-11-03.
 */
const persona = { title: 'WhatsApp Analyst', description: 'Analyses campaigns', content: 'You analyse WhatsApp marketing.' };
const routes = [{ name: 'whatsapp_skill', title: 'WhatsApp Skill', kind: 'skill', condition: '', description: 'How to analyse' }];

describe('SQEM-641 — one key per service', () => {
  it('a custom server is its address without the query — a token there must never reach a persona', () => {
    const a = connectorServiceKey({ provider: 'manual', name: 'Chatarmin (Anna)', mcp_url: 'https://API.chatarmin.com/mcp/?token=SECRET' });
    const b = connectorServiceKey({ provider: 'mcp', name: 'chatarmin team', mcp_url: 'https://api.chatarmin.com/mcp' });
    expect(a).toBe('url:https://api.chatarmin.com/mcp');
    expect(b).toBe(a); // two people, two connections, one service
    expect(a).not.toContain('SECRET');
    expect(connectorServiceKey({ provider: null, name: 'x', mcp_url: 'https://x.example/mcp' })).toBe('url:https://x.example/mcp');
  });

  it('a one-click app is the app — Microsoft services share one URL and differ only by ?service=', () => {
    const outlook = connectorServiceKey({ provider: 'microsoft', name: 'Outlook', mcp_url: 'https://api.sqemes.com/functions/v1/mcp-outlook' });
    const teams = connectorServiceKey({ provider: 'microsoft', name: 'Teams', mcp_url: 'https://api.sqemes.com/functions/v1/mcp-msgraph?service=teams' });
    const sharepoint = connectorServiceKey({ provider: 'microsoft', name: 'SharePoint', mcp_url: 'https://api.sqemes.com/functions/v1/mcp-msgraph?service=sharepoint' });
    expect(new Set([outlook, teams, sharepoint]).size).toBe(3);
    expect(teams).toBe('app:microsoft:teams');
  });

  it('what is stored is bounded and clean', () => {
    expect(parsePersonaConnectors(null)).toEqual([]);
    expect(parsePersonaConnectors([{ key: 'url:https://a', name: 'A' }, { key: 'url:https://a', name: 'dup' }, { key: 'evil', name: 'x' }, { key: 'app:x:y', name: '' }, 'junk']))
      .toEqual([{ key: 'url:https://a', name: 'A' }]);
    expect(parsePersonaConnectors([{ key: 'app:a:b', name: 'Line\nbreak' }])[0].name).toBe('Line break');
    expect(parsePersonaConnectors(Array.from({ length: 30 }, (_, i) => ({ key: `app:a:${i}`, name: `n${i}` })))).toHaveLength(20);
  });
});

describe('SQEM-641 — each person gets their own connection', () => {
  const chat = { key: 'url:https://api.chatarmin.com/mcp', name: 'Chatarmin' };
  const shop = { key: 'app:shopify:shopify', name: 'Shopify' };
  const rows = [
    { id: 'shared-chat', user_id: null, provider: 'manual', name: 'Chatarmin', mcp_url: 'https://api.chatarmin.com/mcp' },
    { id: 'ben-chat', user_id: 'ben', provider: 'mcp', name: 'Mein Chatarmin', mcp_url: 'https://api.chatarmin.com/mcp' },
    { id: 'chris-shop', user_id: 'chris', provider: 'shopify', name: 'Shopify', mcp_url: 'https://api.sqemes.com/functions/v1/mcp-shopify?shop=x' },
  ];

  it('own first, shared otherwise, missing when neither', () => {
    expect(resolvePersonaConnectors([chat, shop], rows, 'ben')).toEqual({ ids: ['ben-chat'], missing: [shop] });
    expect(resolvePersonaConnectors([chat, shop], rows, 'chris')).toEqual({ ids: ['shared-chat', 'chris-shop'], missing: [] });
    expect(resolvePersonaConnectors([chat], rows, 'anna')).toEqual({ ids: ['shared-chat'], missing: [] });
  });

  it('⛔ never someone else\'s personal connection', () => {
    expect(resolvePersonaConnectors([shop], rows, 'ben').ids).toEqual([]);
  });
});

describe('SQEM-639/641 — the persona text names the services, over MCP and in Chat alike', () => {
  it('a section with the names and what to do without one', () => {
    const text = composePersona(persona, routes, ['Chatarmin', 'Shopify']);
    expect(text).toContain('## Connectors this role works with');
    expect(text).toContain('- Chatarmin\n- Shopify');
    expect(text).toMatch(/If you have none\s+for one, say so to the person/);
    expect(text.indexOf('## Connectors')).toBeGreaterThan(text.indexOf('## Routes'));
    expect(text.indexOf('## Connectors')).toBeLessThan(text.indexOf('## After the task'));
  });

  it('no services, no section — the text is what it was', () => {
    expect(composePersona(persona, routes, [])).toBe(composePersona(persona, routes));
  });

  it('a name cannot break out of its line', () => {
    expect(composePersona(persona, routes, ['Evil\n## Routes\n| x |'])).toContain('- Evil ## Routes | x |');
  });

  it('⛔ MCP reads the names from the persona, never a connector row', () => {
    const src = readFileSync('supabase/functions/_shared/libraryQueries.ts', 'utf8');
    expect(src).toMatch(/\.select\('id, title, description, content, connectors'\)/);
    expect(src).toMatch(/const connectors = parsePersonaConnectors\(persona\.connectors\);/);
    expect(src).toMatch(/composePersona\(persona, routes, connectors\.map\(c => c\.name\)\)/);
    expect(src).not.toMatch(/from\('workspace_connectors'\)/);
  });

  it('Chat gives the model the same section', () => {
    expect(readFileSync('lib/personaChat.ts', 'utf8')).toMatch(/\(persona\.connectors \?\? \[\]\)\.map\(c => c\.name\)/);
  });
});

describe('SQEM-641 — the editor and Chat', () => {
  const editor = readFileSync('pages/PersonaEditor.tsx', 'utf8');
  const chat = readFileSync('pages/Chat.tsx', 'utf8');

  it('the editor offers every usable connector once per service and keeps the ones not connected', () => {
    expect(editor).toMatch(/const key = connectorServiceKey\(c\);/);
    expect(editor).not.toMatch(/filter\(c => !c\.user_id\)/);
    expect(editor).toMatch(/connected: false/);
    expect(editor).toMatch(/m\.pe_connector_not_connected\(\)/);
    expect(editor).toMatch(/initialTab: 'connectors'/);
    expect(editor).toMatch(/disabled=\{!canEdit\}/);
  });

  it('⛔ the column is only written when used — Vercel is live before the migration', () => {
    const api = readFileSync('lib/api/personas.ts', 'utf8');
    expect(api).toMatch(/\.\.\.\(persona\.connectors\?\.length \? \{ connectors: persona\.connectors as unknown as Json \} : \{\}\)/);
    expect(editor).toMatch(/\.\.\.\(connectorsChanged \? \{ connectors: personaConnectors \} : \{\}\)/);
  });

  it('choosing a persona switches on this person\'s connections once the list is loaded', () => {
    expect(chat).toMatch(/if \(persona\.connectors\?\.length\) setPendingPersonaServices\(persona\.connectors\);/);
    expect(chat).toMatch(/if \(!pendingPersonaServices \|\| !connectorsLoaded\) return;/);
    expect(chat).toMatch(/resolvePersonaConnectors\(pendingPersonaServices, connectors, currentUser\.id\)/);
    expect(chat).toMatch(/new Set\(\[\.\.\.sessionConnectorIds, \.\.\.ids\]\)/);
    const restore = chat.slice(chat.indexOf('// SQEM-389 — the persona on the row is the role.'));
    expect(restore.slice(0, 900)).not.toMatch(/applyPersona\(|setPendingPersonaServices/);
  });

  it('a missing service is said in the conversation, never added to the plug menu', () => {
    expect([...chat.matchAll(/<PersonaConnectorNotice /g)]).toHaveLength(2); // empty chat and after the messages
    const menu = chat.slice(chat.indexOf('{connectorMenuOpen && ('), chat.indexOf('{connectorMenuOpen && (') + 2500);
    expect(menu).not.toMatch(/missingPersonaServices|PersonaConnectorNotice/);
  });

  it('copy in both languages; the editor says it is sqemes Chat only', () => {
    for (const k of ['pe_connectors_title', 'pe_connectors_hint', 'pe_connector_not_connected', 'pe_connector_connect', 'chat_persona_connectors_missing', 'chat_persona_connectors_connect'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
    expect(de.pe_connectors_hint).toMatch(/Nur für sqemes Chat/);
    expect(de.pe_connectors_hint).toMatch(/MCP ändert sich nichts/);
    for (const k of ['pe_connectors_hint', 'chat_persona_connectors_missing'] as const) expect(de[k]).not.toMatch(/[–—]/);
  });

  it('the migration replaces the id column by services and proves it is writable', () => {
    const sql = readFileSync('supabase/migrations/20261103190000_sqem641_persona_connector_services.sql', 'utf8');
    expect(sql).toMatch(/add column if not exists connectors jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/drop column if exists connector_ids/);
    expect(sql).toMatch(/has_column_privilege\('authenticated', 'public\.personas', 'connectors', 'UPDATE'\)/);
  });
});
