import React, { useEffect, useRef, useState } from 'react';
import { Search, Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';

// SQEM-103 — Chat search. Command-palette modal that searches the current workspace's
// chats by BOTH title (chat_sessions) and message content (chat_messages), scoped by RLS
// (own + workspace-shared sessions). Two debounced parallel ILIKE queries, merged by
// session with a matching snippet. Click / Enter navigates to the chat.

interface Result { id: string; title: string; snippet?: string; last: string }

const makeSnippet = (content: string, term: string): string => {
  const idx = content.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return content.slice(0, 90).trim();
  const start = Math.max(0, idx - 32);
  const end = Math.min(content.length, idx + term.length + 58);
  return (start > 0 ? '…' : '') + content.slice(start, end).replace(/\s+/g, ' ').trim() + (end < content.length ? '…' : '');
};

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onSelect: (sessionId: string) => void;
}

const ChatSearchModal = ({ open, onClose, workspaceId, onSelect }: Props) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const like = `%${term}%`;
        const [titleRes, contentRes] = await Promise.all([
          supabase.from('chat_sessions')
            .select('id, title, last_active_at')
            .eq('workspace_id', workspaceId)
            .ilike('title', like)
            .order('last_active_at', { ascending: false })
            .limit(20),
          supabase.from('chat_messages')
            .select('content, chat_sessions!inner(id, title, last_active_at, workspace_id)')
            .eq('chat_sessions.workspace_id', workspaceId)
            .ilike('content', like)
            .order('created_at', { ascending: false })
            .limit(40),
        ]);
        const map = new Map<string, Result>();
        for (const s of titleRes.data ?? []) {
          map.set(s.id, { id: s.id, title: s.title, last: s.last_active_at });
        }
        for (const m of (contentRes.data ?? []) as any[]) {
          const sess = m.chat_sessions;
          if (!sess) continue;
          const existing = map.get(sess.id);
          if (existing) { if (!existing.snippet) existing.snippet = makeSnippet(m.content, term); }
          else map.set(sess.id, { id: sess.id, title: sess.title, snippet: makeSnippet(m.content, term), last: sess.last_active_at });
        }
        const merged = [...map.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));
        setResults(merged);
        setActiveIdx(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, workspaceId]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[activeIdx]; if (r) onSelect(r.id); }
  };

  const term = query.trim();

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh] bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 border-b border-slate-100 dark:border-slate-700">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search chats by title or content…"
            className="flex-1 py-3.5 bg-transparent outline-none text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />}
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {term.length < 2 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">Type at least 2 characters to search.</p>
          ) : results.length === 0 && !loading ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No chats found for “{term}”.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors ${i === activeIdx ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
              >
                <MessageSquare className="w-4 h-4 mt-0.5 text-slate-400 dark:text-slate-500 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{r.title || 'Untitled chat'}</span>
                  {r.snippet && <span className="block text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{r.snippet}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatSearchModal;
