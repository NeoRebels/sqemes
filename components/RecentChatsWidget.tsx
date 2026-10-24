import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useChatSessions } from '../store';
import { ProviderIcon } from './ProviderIcon';
import Card from './ui/Card';
import { fetchExternalChatHistory, setExternalChatPinned, type ExternalChat } from '../lib/api/externalChatHistory';
import { buildHistory, relTime, type HistoryEntry } from '../lib/historyItems';
import { Pin, Loader2, MessageSquare } from 'lucide-react';

// SQEM-085 — "History" on Start: the user's sqemes chats + the extension's external_chat_history,
// source-badged, pinnable (pins persist to the same rows the extension uses).
//
// SQEM-563 — "View all" leads to /history, where search, the source filter and delete live. Same list
// logic as the page, so the two cannot disagree about order or about whose chats they show.
//
// SQEM-575 — the card shows ALL pinned entries and nothing else. It was the five
// newest (pinned first), which made Start a second, shorter History; pinning is now how a chat gets
// onto Start. No cap: a person who pins forty chats asked for forty.

const RecentChatsWidget = () => {
  const { chatSessions, updateChatSession } = useChatSessions();
  const navigate = useNavigate();
  const [external, setExternal] = useState<ExternalChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExternalChatHistory().then(setExternal).catch(() => {/* non-critical */}).finally(() => setLoading(false));
  }, []);

  const all = useMemo(() => buildHistory(chatSessions, external), [chatSessions, external]);
  const pinned = useMemo(() => all.filter(e => e.pinned), [all]);

  const open = (e: HistoryEntry) => {
    if (e.kind === 'sqemes') navigate(`/chat/${e.id}`);
    else if (e.url) window.open(e.url, '_blank', 'noopener,noreferrer');
  };

  const togglePin = async (e: HistoryEntry) => {
    if (e.kind === 'sqemes') { updateChatSession(e.id, { pinned: !e.pinned }); return; }
    setExternal(prev => prev.map(x => x.id === e.id ? { ...x, pinned: !e.pinned } : x));
    try { await setExternalChatPinned(e.id, !e.pinned); }
    catch { setExternal(prev => prev.map(x => x.id === e.id ? { ...x, pinned: e.pinned } : x)); }
  };

  const renderItem = (item: HistoryEntry) => (
    // SQEM-538 — the title is the button and its ::after covers the row; the pin sits above it.
    <div
      key={item.key}
      className="group relative flex items-center gap-3 p-2.5 rounded-control hover:bg-surface-sunken cursor-pointer transition-colors"
    >
      <div className="shrink-0 w-8 h-8 rounded-chip border border-line bg-surface-raised flex items-center justify-center">
        <ProviderIcon provider={item.icon} className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => open(item)}
          className="block w-full text-left text-sm font-medium text-ink truncate after:absolute after:inset-0 after:content-[''] after:rounded-control"
        >
          {item.title}
        </button>
        <p className="text-xs text-ink-subtle truncate">{item.label} · {relTime(item.ts)}</p>
      </div>
      <button
        onClick={ev => { ev.stopPropagation(); togglePin(item); }}
        title={item.pinned ? 'Unpin' : 'Pin'}
        className={`relative z-10 shrink-0 w-7 h-7 rounded-chip flex items-center justify-center transition-colors ${
          item.pinned ? 'text-accent' : 'text-ink-subtle reveal-on-hover hover:text-accent'
        }`}
      >
        <Pin className="w-4 h-4" fill={item.pinned ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-ink-strong">History</h2>
        {all.length > 0 && (
          <Link to="/history" className="text-xs font-medium text-accent hover:underline">
            View all ({all.length}) →
          </Link>
        )}
      </div>
      {loading && all.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-subtle"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : all.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <MessageSquare className="w-6 h-6 text-ink-subtle" />
          <p className="text-sm text-ink-muted">No chats yet.</p>
        </div>
      ) : pinned.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Pin className="w-6 h-6 text-ink-subtle" />
          <p className="text-sm text-ink-muted">Pin a chat in History to keep it here.</p>
        </div>
      ) : (
        <div className="space-y-1">{pinned.map(renderItem)}</div>
      )}
    </Card>
  );
};

export default RecentChatsWidget;
