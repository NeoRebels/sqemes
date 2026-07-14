import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatSessions } from '../store';
import { ProviderIcon } from './ProviderIcon';
import Card from './ui/Card';
import { fetchExternalChatHistory, setExternalChatPinned, type ExternalChat } from '../lib/api/externalChatHistory';
import { Pin, Loader2, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';

// SQEM-085 — unified "History": the user's Sqemes chat_sessions + the extension's
// external_chat_history, source-badged, pinnable (pins persist to the same rows the
// extension uses), grouped into Pinned / Recent, newest-first, paginated.
const PLATFORM: Record<string, { label: string; icon: string }> = {
  chatgpt: { label: 'ChatGPT', icon: 'openai' },
  claude: { label: 'Claude', icon: 'claude' },
  gemini: { label: 'Gemini', icon: 'gemini' },
  grok: { label: 'Grok', icon: 'grok' },
  deepseek: { label: 'DeepSeek', icon: 'deepseek' },
  perplexity: { label: 'Perplexity', icon: 'perplexity' },
};

// Pins stay visible (capped, with a "Show N more" expander); only Recent paginates.
// A page shows at most TOTAL_CAP rows — the (capped) pinned block takes priority and
// Recent fills the remainder, so 3 pinned → 4 recent, 0 pinned → 7 recent.
const PINNED_CAP = 5;
const TOTAL_CAP = 7;

interface Item {
  key: string;
  icon: string;
  label: string;
  title: string;
  pinned: boolean;
  ts: number;
  onOpen: () => void;
  onTogglePin: () => void;
}

function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const RecentChatsWidget = () => {
  const { chatSessions, updateChatSession } = useChatSessions();
  const navigate = useNavigate();
  const [external, setExternal] = useState<ExternalChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pinsExpanded, setPinsExpanded] = useState(false);

  useEffect(() => {
    fetchExternalChatHistory().then(setExternal).catch(() => {/* non-critical */}).finally(() => setLoading(false));
  }, []);

  const items: Item[] = useMemo(() => {
    const sqemes: Item[] = chatSessions.map(s => ({
      key: `s-${s.id}`, icon: 'sqemes', label: 'Sqemes', title: s.title || 'New chat',
      pinned: s.pinned, ts: new Date(s.lastActiveAt).getTime(),
      onOpen: () => navigate(`/chat/${s.id}`),
      onTogglePin: () => updateChatSession(s.id, { pinned: !s.pinned }),
    }));
    const ext: Item[] = external.map(e => {
      const meta = PLATFORM[e.platform] ?? { label: e.platform, icon: e.platform };
      return {
        key: `e-${e.id}`, icon: meta.icon, label: meta.label, title: e.title || 'Untitled chat',
        pinned: e.pinned, ts: new Date(e.lastSeenAt).getTime(),
        onOpen: () => window.open(e.url, '_blank', 'noopener,noreferrer'),
        onTogglePin: async () => {
          const next = !e.pinned;
          setExternal(prev => prev.map(x => x.id === e.id ? { ...x, pinned: next } : x));
          try { await setExternalChatPinned(e.id, next); }
          catch { setExternal(prev => prev.map(x => x.id === e.id ? { ...x, pinned: e.pinned } : x)); }
        },
      };
    });
    return [...sqemes, ...ext].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.ts - a.ts));
  }, [chatSessions, external, navigate, updateChatSession]);

  const pinnedAll = items.filter(i => i.pinned);
  const recentAll = items.filter(i => !i.pinned);

  // Pins are always shown (they're the "keep coming back" set), capped with an expander.
  const pinnedVisible = pinsExpanded ? pinnedAll : pinnedAll.slice(0, PINNED_CAP);
  const pinnedOverflow = pinnedAll.length - PINNED_CAP;

  // Recent fills the remainder of the TOTAL_CAP budget after the (capped) pinned block,
  // so a page never shows more than 7 rows. Only Recent paginates; clamp at read-time so
  // pin/unpin or a late load can't strand us on an out-of-range page.
  const recentPageSize = Math.max(1, TOTAL_CAP - Math.min(pinnedAll.length, PINNED_CAP));
  const pageCount = Math.max(1, Math.ceil(recentAll.length / recentPageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const recentPage = recentAll.slice(currentPage * recentPageSize, currentPage * recentPageSize + recentPageSize);

  const renderItem = (item: Item) => (
    <div
      key={item.key}
      onClick={item.onOpen}
      className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
    >
      <div className="shrink-0 w-8 h-8 rounded-lg border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center">
        <ProviderIcon provider={item.icon} className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{item.title}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{item.label} · {relTime(new Date(item.ts).toISOString())}</p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); item.onTogglePin(); }}
        title={item.pinned ? 'Unpin' : 'Pin'}
        className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
          item.pinned
            ? 'text-brand-600 dark:text-brand-400'
            : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 hover:text-brand-600'
        }`}
      >
        <Pin className="w-4 h-4" fill={item.pinned ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  const renderSection = (label: string, rows: Item[]) => {
    if (rows.length === 0) return null;
    return (
      <div>
        <p className="px-1 pb-1 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
        <div className="space-y-1">{rows.map(renderItem)}</div>
      </div>
    );
  };

  const renderPinned = () => {
    if (pinnedAll.length === 0) return null;
    return (
      <div>
        <p className="px-1 pb-1 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Pinned</p>
        <div className="space-y-1">{pinnedVisible.map(renderItem)}</div>
        {pinnedOverflow > 0 && (
          <button
            onClick={() => setPinsExpanded(v => !v)}
            className="mt-1.5 ml-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            {pinsExpanded ? 'Show less' : `Show ${pinnedOverflow} more`}
          </button>
        )}
      </div>
    );
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-slate-800 dark:text-slate-100 text-lg">History</h2>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              title="Newer"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-brand-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums select-none">{currentPage + 1} / {pageCount}</span>
            <button
              onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
              disabled={currentPage >= pageCount - 1}
              title="Older"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-brand-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <MessageSquare className="w-6 h-6 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400 dark:text-slate-500">No chats yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {renderPinned()}
          {renderSection('Recent', recentPage)}
        </div>
      )}
    </Card>
  );
};

export default RecentChatsWidget;
