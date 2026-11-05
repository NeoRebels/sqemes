import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, de } from './i18nText';

/**
 * SQEM-635 — connectors are kept per chat session and start empty (replaces SQEM-436's "always sent,
 * the icon is only a status").
 *
 * Why it was reversed: every message carried every connector, the model called them for tasks that
 * did not need them, and for one customer one round pushed a request past Claude's 1M tokens (2026-10-29).
 * Decided 2026-11-03: off for everyone, for the session, not per message.
 *
 * ⭐ SQEM-651 (2026-11-04) removed the switches: the model sees every connected service by name and
 * fetches one when it needs it (`_shared/connectorPool.ts`). The session column stays — it is where a
 * fetched connector is kept, so the next message does not fetch it again.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const CHAT = read('pages/Chat.tsx');
const API = read('lib/api/chatSessions.ts');
const MIGRATION = read('supabase/migrations/20261103130000_sqem635_session_connectors.sql');

describe('SQEM-635/651 — connectors per session, fetched on demand', () => {
  it('the column starts empty, for new AND existing sessions, and is self-tested', () => {
    expect(MIGRATION).toMatch(/add column if not exists connector_ids uuid\[\] not null default '\{\}'/);
    expect(MIGRATION).toMatch(/cardinality\(connector_ids\) > 0/);
  });

  it('only the connectors in use that still exist are sent, and none to a model that cannot use them', () => {
    expect(CHAT).toMatch(/connectors\.filter\(c => sessionConnectorIds\.includes\(c\.id\)\)\.map\(c => c\.id\)/);
    expect(CHAT).toMatch(/const activeConnectorIds = connectorsSupported \? inUseConnectorIds : \[\];/);
    expect(CHAT).toMatch(/connectorIds: activeConnectorIds/);
    // ⛔ the SQEM-436 line that sent every connector is gone
    expect(CHAT).not.toMatch(/connectorsSupported \? connectors\.map\(c => c\.id\) : \[\]/);
  });

  it('the choice lives on the session: restored on load, cleared on a new chat, carried into a new row', () => {
    expect(API).toMatch(/\.select\('applied_skill_ids, persona_id, connector_ids'\)/);
    expect(API).toMatch(/if \(applied\.connectorIds\) patch\.connector_ids = applied\.connectorIds;/);
    expect(API).toMatch(/connector_ids: connectorIds \?\? \[\]/);
    expect(CHAT).toMatch(/setSessionConnectorIds\(applied\.connectorIds\)/);
    // a failed restore and a new chat both land on "off"
    expect(CHAT.match(/setSessionConnectorIds\(\[\]\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(CHAT).toMatch(/updateAppliedContext\(sessionId, \{ connectorIds: next \}\)/);
    expect(CHAT).toMatch(/activePersona\?\.id,[^\n]*\n\s*sessionConnectorIds,/);
  });

  it('⛔ there is no connector icon or menu in the composer any more (SQEM-651, decided 2026-11-04)', () => {
    expect(CHAT).not.toMatch(/connectorMenuOpen|connectorMenuRef/);
    expect(CHAT).not.toMatch(/<Switch/);
    expect(CHAT).not.toMatch(/toggleConnector/);
    expect(CHAT).not.toMatch(/txt\.chat_connectors_/);
  });

  it('a connector the model fetched is kept on the session of that message (SQEM-651)', () => {
    expect(CHAT).toMatch(/carriedConnectorIds = Array\.isArray\(meta\.connectorIds\)/);
    expect(CHAT).toMatch(/updateAppliedContext\(activeSessionId, \{ connectorIds: next \}\)/);
    expect(CHAT).toMatch(/if \(sessionLoadedRef\.current === activeSessionId\) setSessionConnectorIds\(next\);/);
  });

  it('the menu texts are gone; the line under an answer is what says a connector was fetched', () => {
    for (const k of ['chat_connectors_title', 'chat_connectors_button', 'chat_connectors_hint', 'chat_connectors_in_use', 'chat_connectors_manage', 'chat_connectors_builtin', 'chat_connectors_inactive_label', 'chat_connectors_inactive', 'chat_connectors_image_models']) {
      expect(Object.keys(en), k).not.toContain(k);
      expect(Object.keys(de), k).not.toContain(k);
    }
    expect(en.chat_connectors_fetched).toBeTruthy();
    // ⛔ "Your MCP Connectors are active" is no longer true and must not come back
    expect(Object.keys(en)).not.toContain('chat_connectors_active');
  });
});
