/**
 * SQEM-563 — the History: one person's sqemes chats and the chats the browser extension recorded on
 * ChatGPT, Claude, Gemini … (`external_chat_history`), as one list. Used by the History page and the
 * Start widget, so both sort and filter the same way.
 *
 * ⚠️ Not the History page the product vision (`pm/VISION.md` in the source repository) lists as
 * removed. That was PromptRunner's execution log (SQEM-042); this is the list of chat sessions, which
 * the vision names as the record that replaced it.
 *
 * Pure, types-only imports — tested directly (lib/supabase throws at import time without env vars).
 * Texts come from messages/ (SQEM-611); titles, warnings and times follow the app language.
 */
import type { ChatSession } from '../types';
import { m, getLocale } from './i18n';
import type { ExternalChat } from './api/externalChatHistory';

/** The platforms the extension records, with the icon `ProviderIcon` knows them by. */
export const PLATFORM: Record<string, { label: string; icon: string }> = {
  chatgpt: { label: 'ChatGPT', icon: 'openai' },
  claude: { label: 'Claude', icon: 'claude' },
  gemini: { label: 'Gemini', icon: 'gemini' },
  grok: { label: 'Grok', icon: 'grok' },
  deepseek: { label: 'DeepSeek', icon: 'deepseek' },
  perplexity: { label: 'Perplexity', icon: 'perplexity' },
};

export interface HistoryEntry {
  key: string;
  kind: 'sqemes' | 'external';
  /** The row id in `chat_sessions` or `external_chat_history`. */
  id: string;
  /** `sqemes`, or the platform (`chatgpt`, `claude`, …) — what the source filter matches. */
  source: string;
  icon: string;
  label: string;
  title: string;
  pinned: boolean;
  ts: number;
  /** Where an external chat lives; sqemes chats open in /chat/:id. */
  url?: string;
  /** A sqemes chat shared with the workspace — deleting it removes it for collaborators too. */
  shared?: boolean;
}

/**
 * Pinned first, then newest first. Only the person's OWN sqemes chats: the store's realtime channel
 * can add a colleague's shared session, and History is a person's own record, not the workspace's.
 */
export function buildHistory(sessions: ChatSession[], external: ExternalChat[]): HistoryEntry[] {
  const own: HistoryEntry[] = sessions.filter(s => s.isOwner).map(s => ({
    key: `s-${s.id}`, kind: 'sqemes', id: s.id, source: 'sqemes', icon: 'sqemes', label: 'sqemes',
    title: s.title || m.hi_new_chat(), pinned: s.pinned, ts: new Date(s.lastActiveAt).getTime(),
    shared: s.visibility === 'workspace',
  }));
  const ext: HistoryEntry[] = external.map(e => {
    const meta = PLATFORM[e.platform] ?? { label: e.platform, icon: e.platform };
    return {
      key: `e-${e.id}`, kind: 'external', id: e.id, source: e.platform, icon: meta.icon, label: meta.label,
      title: e.title || m.chatsearch_untitled(), pinned: e.pinned, ts: new Date(e.lastSeenAt).getTime(), url: e.url,
    };
  });
  return [...own, ...ext].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.ts - a.ts));
}

/** Title search (case-insensitive) and an optional source; order is kept. */
export function filterHistory(entries: HistoryEntry[], { query = '', source = 'all' }: { query?: string; source?: string }): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(e => (source === 'all' || e.source === source) && (!q || e.title.toLowerCase().includes(q)));
}

/** The sources present, sqemes first, then by label — for the filter, so it never offers an empty one. */
export function historySources(entries: HistoryEntry[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const e of entries) if (!seen.has(e.source)) seen.set(e.source, e.label);
  return [...seen.entries()]
    .sort(([a, la], [b, lb]) => (a === 'sqemes' ? -1 : b === 'sqemes' ? 1 : la.localeCompare(lb)))
    .map(([value, label]) => ({ value, label }));
}

/** What the delete dialog says, so a person knows how far a delete reaches before confirming. */
export function deleteWarning(e: HistoryEntry): string {
  if (e.kind === 'external') {
    return m.hi_del_external({ platform: e.label });
  }
  return e.shared
    ? m.hi_del_shared()
    : m.hi_del_own();
}

/** SQEM-576 — the warning for a bulk delete: what happens to each kind in the selection. */
export function bulkDeleteWarning(entries: HistoryEntry[]): string {
  const own = entries.filter(e => e.kind === 'sqemes');
  const ext = entries.length - own.length;
  const lines: string[] = [];
  if (own.length) {
    const shared = own.filter(e => e.shared).length;
    lines.push(m.hi_bulk_own({ count: own.length }) + (shared ? m.hi_bulk_shared({ count: shared }) : '') + m.hi_cannot_undo());
  }
  if (ext) {
    lines.push(m.hi_bulk_ext({ count: ext }));
  }
  return lines.join(' ');
}

export function relTime(ts: number, now = Date.now()): string {
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return m.chat_time_just_now();
  if (mins < 60) return m.chat_time_minutes({ count: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return m.chat_time_hours({ count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return m.chat_time_days({ count: d });
  return new Date(ts).toLocaleDateString(getLocale());
}
