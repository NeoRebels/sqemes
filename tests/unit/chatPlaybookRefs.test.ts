import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildPendingRef, finalizeRef, pendingFromSent, parsePlaybookRef, normalizeLoadedIds, usedPlaybooks,
  messagePlaybookFields, MAX_REF_FIELDS, MAX_FIELD_NAME, MAX_FIELD_VALUE, MAX_REF_TITLE, MAX_LOADED_IDS,
} from '../../lib/playbookRef';
import { jobEventFor } from '../../supabase/functions/_shared/jobEvents';

/**
 * SQEM-551 — the playbook card on a user message and the "Used" chips under an answer.
 * Pure logic is tested directly; the wiring (Chat, the API layer, the chat function, the migration)
 * at source level, because those files import lib/supabase or run on Deno.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const tpl = { id: A, title: 'Quarterly report', kind: 'prompt' as const };

describe('SQEM-551 — the playbook card (pure)', () => {
  it('keeps text fields by their label, drops file fields and empty values', () => {
    const p = buildPendingRef(tpl, [
      { name: 'client', label: 'Client', type: 'text' },
      { name: 'brief', label: '', type: 'textarea' },
      { name: 'deck', label: 'Deck', type: 'file' },
      { name: 'tone', label: 'Tone', type: 'select' },
    ], { client: ' ACME ', brief: 'Short', deck: 'x.pdf', tone: '' }, 'TEXT');
    expect(p.ref.fields).toEqual([{ name: 'Client', value: 'ACME' }, { name: 'brief', value: 'Short' }]);
    expect(p.insertedText).toBe('TEXT');
  });

  it('caps title, names, values and the number of fields', () => {
    const vars = Array.from({ length: 40 }, (_, i) => ({ name: `v${i}`, label: 'n'.repeat(500), type: 'text' as const }));
    const inputs = Object.fromEntries(vars.map(v => [v.name, 'x'.repeat(2000)]));
    const p = buildPendingRef({ ...tpl, title: 't'.repeat(1000) }, vars, inputs, 'T');
    expect(p.ref.title.length).toBe(MAX_REF_TITLE);
    expect(p.ref.fields).toHaveLength(MAX_REF_FIELDS);
    expect(p.ref.fields[0].name.length).toBe(MAX_FIELD_NAME);
    expect(p.ref.fields[0].value.length).toBe(MAX_FIELD_VALUE);
  });

  it('the worst case stays under the 64 KB CHECK even at 4 bytes per character', () => {
    const big = '😀'.repeat(5000); // 4 bytes in UTF-8, 2 UTF-16 units — clip counts units, so this is the pessimistic side
    const vars = Array.from({ length: 40 }, (_, i) => ({ name: `v${i}`, label: big, type: 'text' as const }));
    const p = buildPendingRef({ ...tpl, title: big }, vars, Object.fromEntries(vars.map(v => [v.name, big])), 'T');
    const bytes = new TextEncoder().encode(JSON.stringify(finalizeRef(p, 'T'))).length;
    expect(bytes).toBeLessThan(65536);
  });

  it('`edited` only when the text sent differs from the text the playbook produced', () => {
    const p = buildPendingRef(tpl, [], {}, 'Write the report');
    expect(finalizeRef(p, '  Write the report ')!.edited).toBe(false);
    expect(finalizeRef(p, 'Write the report, shorter')!.edited).toBe(true);
    expect(finalizeRef(p, '   ')).toBeNull();
    expect(finalizeRef(null, 'anything')).toBeNull();
  });

  it('"Edit" on a sent message brings the card back and never loses an earlier "edited"', () => {
    const sent = { ...tpl, fields: [], edited: true };
    const again = pendingFromSent(sent, 'Edited text');
    expect(finalizeRef(again, 'Edited text')!.edited).toBe(true);
    expect(finalizeRef(pendingFromSent({ ...sent, edited: false }, 'Same'), 'Same')!.edited).toBe(false);
    expect(pendingFromSent(null, 'x')).toBeNull();
  });

  it('reading from the database: a malformed ref is no ref', () => {
    expect(parsePlaybookRef(null)).toBeNull();
    expect(parsePlaybookRef({ id: A, title: '', kind: 'prompt' })).toBeNull();
    expect(parsePlaybookRef({ id: A, title: 'T', kind: 'assistant' })).toBeNull();
    expect(parsePlaybookRef({ id: A, title: 'T', kind: 'prompt', fields: [{ name: 'a', value: 1 }, { name: 'b', value: 'c' }], edited: 'yes' }))
      .toEqual({ id: A, title: 'T', kind: 'prompt', fields: [{ name: 'b', value: 'c' }], edited: false });
  });
});

describe('SQEM-551 — "Used" chips (pure)', () => {
  it('unique uuids, in load order, capped', () => {
    expect(normalizeLoadedIds([B, A, B, 'not-a-uuid', 7, C])).toEqual([B, A, C]);
    expect(normalizeLoadedIds('x')).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(normalizeLoadedIds(many)).toHaveLength(MAX_LOADED_IDS);
  });

  it('only playbooks the viewer can see get a chip — the rest is left out, not named', () => {
    const visible = new Map([[A, { title: 'Brand voice', kind: 'skill' as const }]]);
    expect(usedPlaybooks([B, A], visible)).toEqual([{ id: A, title: 'Brand voice', kind: 'skill' }]);
    expect(usedPlaybooks(undefined, visible)).toEqual([]);
  });

  it('one row mapping for both read paths', () => {
    expect(messagePlaybookFields({ playbook_ref: { id: A, title: 'T', kind: 'prompt', fields: [], edited: true }, loaded_template_ids: [B] }))
      .toEqual({ playbookRef: { id: A, title: 'T', kind: 'prompt', fields: [], edited: true }, loadedTemplateIds: [B], libraryChanges: [] });
    // SQEM-561 — the same mapping carries the change card, so a collaborator sees it too.
    expect(messagePlaybookFields({ library_changes: [{ action: 'deleted', kind: 'skill', id: A, title: 'Old' }] }).libraryChanges)
      .toEqual([{ action: 'deleted', kind: 'skill', id: A, title: 'Old' }]);
    expect(messagePlaybookFields({})).toEqual({ playbookRef: null, loadedTemplateIds: [], libraryChanges: [] });
  });
});

describe('SQEM-551 — wiring', () => {
  it('the chat function collects what get_template loaded and sends it with the result, as a result', () => {
    const fn = read('supabase/functions/chat-message/index.ts');
    expect(fn).toMatch(/onTemplateLoaded: \(templateId\) => \{\s*if \(!loadedTemplateIds\.includes\(templateId\) && loadedTemplateIds\.length < MAX_LOADED_IDS\) loadedTemplateIds\.push\(templateId\);\s*countUsage\(/);
    // SQEM-561 widened the payload; the ids still ride only when there are any.
    expect(fn).toMatch(/broadcastJobResult\(jobId, \{\s*result,\s*\.\.\.\(loadedTemplateIds\.length \? \{ loadedTemplateIds \} : \{\}\),/);
    expect(jobEventFor({ result: 'x', libraryChanges: [] })).toBe('result');
    // ⛔ SQEM-374: the event name is decided by the payload's keys — the extra key must not turn a result into a delta.
    expect(jobEventFor({ result: 'x', loadedTemplateIds: [A] })).toBe('result');
  });

  it('the client hands the extra field to Chat and stores both kinds', () => {
    expect(read('lib/realtimeJob.ts')).toMatch(/onResultMeta\?\.\(\{ loadedTemplateIds: payload\.loadedTemplateIds, libraryChanges: payload\.libraryChanges \}\);\s*resolve\(/);
    const api = read('lib/api/chatSessions.ts');
    expect(api).toMatch(/\.\.\.messagePlaybookFields\(row\)/);
    expect(api).toMatch(/playbook_ref: extra\.playbookRef/);
    expect(api).toMatch(/loaded_template_ids: extra\.loadedTemplateIds/);
  });

  it('Chat: attached at send, read on BOTH paths (history and a collaborator\'s Realtime insert)', () => {
    const chat = read('pages/Chat.tsx');
    expect(chat).toMatch(/pendingPlaybookRef\.current = buildPendingRef\(template, template\.variables \?\? \[\], inputs, text\)/);
    expect(chat).toMatch(/const playbookRef = finalizeRef\(pendingPlaybookRef\.current, trimmed\)/);
    expect(chat).toMatch(/userMsg\.id, \{ playbookRef \}\)/);
    expect(chat).toMatch(/assistantMsgId, \{ loadedTemplateIds, libraryChanges \}\)/);
    expect(chat).toMatch(/playbookRef: m\.playbookRef, loadedTemplateIds: m\.loadedTemplateIds/);
    expect(chat).toMatch(/\.\.\.messagePlaybookFields\(row\), \/\/ SQEM-551/);
    expect(chat).toMatch(/if \(!input\.trim\(\)\) pendingPlaybookRef\.current = null;/);
  });

  it('the card keeps the text (collapsed) and links only what the viewer can open', () => {
    const card = read('components/ChatPlaybookCard.tsx');
    expect(card).toMatch(/<summary[^>]*>Text sent<\/summary>/);
    expect(card).toMatch(/\{content\}<\/p>/);
    expect(read('pages/Chat.tsx')).toMatch(/linkable=\{playbookTitles\.has\(msg\.playbookRef\.id\)\}/);
  });

  it('the migration: two nullable columns, one per role, capped', () => {
    const sql = read('supabase/migrations/20261021213000_sqem551_chat_message_playbooks.sql');
    expect(sql).toMatch(/add column playbook_ref jsonb,\s*add column loaded_template_ids uuid\[\];/);
    expect(sql).toMatch(/role = 'user' and jsonb_typeof\(playbook_ref\) = 'object' and octet_length\(playbook_ref::text\) <= 65536/);
    expect(sql).toMatch(/role = 'assistant' and cardinality\(loaded_template_ids\) <= 20/);
    expect(sql).not.toMatch(/create policy|security definer/i);
  });
});
