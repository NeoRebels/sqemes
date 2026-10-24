import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildHistory, bulkDeleteWarning } from '../../lib/historyItems';
import type { ChatSession } from '../../types';

/** SQEM-576 — History: multi-select and bulk delete, as on Playbooks and Personas. */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const session = (o: Partial<ChatSession>): ChatSession => ({
  id: 's1', workspaceId: 'w', userId: 'me', title: 'Brief', createdAt: '2026-10-01T00:00:00Z',
  lastActiveAt: '2026-10-20T10:00:00Z', visibility: 'private', model: 'm', appliedSkillIds: [],
  isOwner: true, isGenerating: false, pinned: false, ...o,
} as ChatSession);
const ext = (o: Record<string, unknown>) => ({ id: 'e1', platform: 'chatgpt', title: 'Plan', url: 'https://chatgpt.com/c/1', pinned: false, lastSeenAt: '2026-10-21T10:00:00Z', ...o });

describe('bulkDeleteWarning', () => {
  it('names what happens to each kind, with counts', () => {
    const h = buildHistory([session({ id: 'a' }), session({ id: 'b', visibility: 'workspace' })], [ext({ id: 'x' })]);
    const w = bulkDeleteWarning(h);
    expect(w).toMatch(/^2 sqemes chats and all their messages will be deleted — 1 is shared with your workspace and disappears for everyone\. This cannot be undone\./);
    expect(w).toMatch(/1 extension entry is removed from your sqemes history only/);
  });
  it('singular, nothing shared, no extension sentence', () => {
    const w = bulkDeleteWarning(buildHistory([session({ id: 'a' })], []));
    expect(w).toBe('1 sqemes chat and all its messages will be deleted. This cannot be undone.');
  });
});

describe('wiring', () => {
  const page = read('pages/History.tsx');
  it('a checkbox per row and the shared BulkActionBar', () => {
    expect(page).toMatch(/<Checkbox[\s\S]*?toggleSelect\(e\.key\)/);
    expect(page).toMatch(/<BulkActionBar[\s\S]*?noun="chat"/);
  });
  it('⛔ only visible rows count as selected — a filtered-out chat is never deleted', () => {
    expect(page).toMatch(/const selected = shown\.filter\(e => selectedKeys\.has\(e\.key\)\)/);
    expect(page).toMatch(/onDelete=\{\(\) => setBulkDelete\(selected\)\}/);
  });
  it('bulk delete is confirmed and reports ONE result', () => {
    expect(page).toMatch(/onConfirm=\{confirmBulkDelete\}/);
    expect(page).toMatch(/deleteChatSessions\(own\)/);
    expect(read('store/data.tsx')).toMatch(/const deleteChatSessions = useCallback[\s\S]*?Promise\.allSettled/);
  });
});
