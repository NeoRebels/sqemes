import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildHistory, filterHistory, historySources, deleteWarning, type HistoryEntry } from '../../lib/historyItems';
import type { ChatSession } from '../../types';
import { en } from './i18nText';

/** SQEM-563 — History as its own Work page, with delete. */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const session = (o: Partial<ChatSession>): ChatSession => ({
  id: 's1', workspaceId: 'w', userId: 'me', title: 'Brief', createdAt: '2026-10-01T00:00:00Z',
  lastActiveAt: '2026-10-20T10:00:00Z', visibility: 'private', model: 'm', appliedSkillIds: [],
  isOwner: true, isGenerating: false, pinned: false, ...o,
} as ChatSession);
const ext = (o: Record<string, unknown>) => ({ id: 'e1', platform: 'chatgpt', title: 'Plan', url: 'https://chatgpt.com/c/1', pinned: false, lastSeenAt: '2026-10-21T10:00:00Z', ...o });

describe('buildHistory', () => {
  it('pinned first, then newest first, across both sources', () => {
    const h = buildHistory(
      [session({ id: 'old', lastActiveAt: '2026-10-01T00:00:00Z' }), session({ id: 'pin', pinned: true, lastActiveAt: '2026-09-01T00:00:00Z' })],
      [ext({ id: 'new' })],
    );
    expect(h.map(e => e.id)).toEqual(['pin', 'new', 'old']);
  });

  it('⛔ only the person\'s OWN sqemes chats — a colleague\'s shared session is not their history', () => {
    const h = buildHistory([session({ id: 'theirs', isOwner: false, visibility: 'workspace' }), session({ id: 'mine' })], []);
    expect(h.map(e => e.id)).toEqual(['mine']);
  });

  it('marks a shared own chat, and maps a platform to its label and icon', () => {
    const [s, e] = buildHistory([session({ visibility: 'workspace', lastActiveAt: '2026-10-22T00:00:00Z' })], [ext({ platform: 'claude' })]);
    expect(s.shared).toBe(true);
    expect(e).toMatchObject({ kind: 'external', source: 'claude', label: 'Claude', icon: 'claude', url: 'https://chatgpt.com/c/1' });
  });
});

describe('filter and sources', () => {
  const all = buildHistory([session({ title: 'Quarterly brief' })], [ext({ title: 'Brief for Anna' }), ext({ id: 'e2', platform: 'claude', title: 'Code review' })]);

  it('searches titles case-insensitively and filters by source', () => {
    expect(filterHistory(all, { query: 'BRIEF' }).map(e => e.id)).toEqual(['e1', 's1']);
    expect(filterHistory(all, { source: 'claude' }).map(e => e.id)).toEqual(['e2']);
    expect(filterHistory(all, { query: 'brief', source: 'sqemes' }).map(e => e.id)).toEqual(['s1']);
  });

  it('offers only sources that exist, sqemes first', () => {
    expect(historySources(all)).toEqual([
      { value: 'sqemes', label: 'sqemes' }, { value: 'chatgpt', label: 'ChatGPT' }, { value: 'claude', label: 'Claude' },
    ]);
  });
});

describe('the delete dialog says how far a delete reaches', () => {
  const base = { key: 'k', id: 'i', icon: 'x', title: 't', pinned: false, ts: 0 } as const;
  it('external: only the entry, comes back on the next visit', () => {
    const w = deleteWarning({ ...base, kind: 'external', source: 'chatgpt', label: 'ChatGPT' } as HistoryEntry);
    expect(w).toMatch(/stays in ChatGPT/);
    expect(w).toMatch(/recorded again/);
  });
  it('shared sqemes chat: gone for everyone', () => {
    expect(deleteWarning({ ...base, kind: 'sqemes', source: 'sqemes', label: 'sqemes', shared: true } as HistoryEntry)).toMatch(/disappears for everyone/);
    expect(deleteWarning({ ...base, kind: 'sqemes', source: 'sqemes', label: 'sqemes' } as HistoryEntry)).not.toMatch(/everyone/);
  });
});

describe('wiring', () => {
  it('route, sidebar link and the delete API', () => {
    expect(read('App.tsx')).toMatch(/<Route path="\/history" element=\{<LayoutPage><History \/><\/LayoutPage>\} \/>/);
    expect(read('components/Sidebar.tsx')).toMatch(/\{ to: "\/history", icon: HistoryIcon, label: m\.nav_history\(\) \}/);
    expect(JSON.parse(read('messages/en.json')).nav_history).toBe('History'); // SQEM-599 — the word lives in messages/
    const api = read('lib/api/externalChatHistory.ts');
    expect(api).toMatch(/from\('external_chat_history'\)\.delete\(\)\.eq\('id', id\)\.select\('id'\)/);
    expect(api).toMatch(/if \(!data\?\.length\) throw/);
  });

  it('SQEM-575 — the Start widget shows ALL pinned entries of the same list, nothing else', () => {
    const w = read('components/RecentChatsWidget.tsx');
    expect(w).toMatch(/buildHistory\(chatSessions, external\)/);
    expect(w).toMatch(/all\.filter\(e => e\.pinned\)/);
    expect(w).toMatch(/pinned\.map\(renderItem\)/);
    expect(w).not.toMatch(/PREVIEW_COUNT|\.slice\(0,/); // no cap
    expect(w).toMatch(/m\.recent_pin_hint\(\)/);
    expect(en.recent_pin_hint).toBe('Pin a chat in History to keep it here.'); // SQEM-604
    expect(w).toMatch(/<Link to="\/history"/);
    expect(w).not.toMatch(/ChevronLeft|setPage|Trash2|deleteExternalChat/); // no paging, no delete
  });

  it('redesign C: page frame like Personas, tokens only, list as a card, EmptyState', () => {
    for (const f of ['pages/History.tsx', 'components/RecentChatsWidget.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\b(?:slate|brand)-\d/);   // palette steps → tokens
      expect(src, f).not.toMatch(/rounded-(?:xl|lg)\b/);     // radius by role
    }
    const page = read('pages/History.tsx');
    // The list pages' padding, but 3xl wide (7xl was tried and dropped).
    expect(page).toMatch(/className="p-4 md:p-8 pb-16 md:pb-20 max-w-3xl mx-auto"/);
    expect(page).toMatch(/rounded-card border border-line bg-surface-raised p-2/);
    expect(page).toMatch(/<EmptyState/);
  });

  it('full titles on the History page; the sidebar block is "Recent Chats"', () => {
    const page = read('pages/History.tsx');
    expect(page).toMatch(/text-sm font-medium text-ink break-words/);
    expect(page).not.toMatch(/font-medium text-ink truncate/);
    expect(read('components/Sidebar.tsx')).toMatch(/>\{m\.sb_recent\(\)\}<\/p>/);
    expect(en.sb_recent).toBe('Recent Chats'); // SQEM-611
    // ⛔ Padding: inside the parent's space-y-1 a margin class is overridden (SQEM-563, measured in the build CSS).
    expect(read('components/Sidebar.tsx')).toMatch(/<div className="pt-5 pb-6">\s*<p className="px-3 mb-1[^"]*">\{m\.sb_recent\(\)\}</);
    expect(read('pages/History.tsx')).toMatch(/section\(m\.sb_recent\(\), recent\)/);
  });

  it('the page asks before deleting', () => {
    const page = read('pages/History.tsx');
    expect(page).toMatch(/<ConfirmModal/);
    expect(page).toMatch(/onClick=\{\(\) => setToDelete\(e\)\}/);
  });
});
