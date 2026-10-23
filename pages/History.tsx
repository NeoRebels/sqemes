import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Pin, Trash2, Loader2, MessageSquare, Filter } from 'lucide-react';
import { useChatSessions, useUI } from '../store';
import { ProviderIcon } from '../components/ProviderIcon';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SelectFilter from '../components/ui/SelectFilter';
import ConfirmModal from '../components/ui/ConfirmModal';
import EmptyState from '../components/ui/EmptyState';
import { fetchExternalChatHistory, setExternalChatPinned, deleteExternalChat, type ExternalChat } from '../lib/api/externalChatHistory';
import { buildHistory, filterHistory, historySources, deleteWarning, relTime, type HistoryEntry } from '../lib/historyItems';

/**
 * SQEM-563 — History: the person's own sqemes chats and the chats the browser extension recorded,
 * in one list, with search, a source filter, pinning and delete. Work mode, every role.
 *
 * ⚠️ Not the History page the product vision (`pm/VISION.md` in the source repository) lists as
 * removed — PromptRunner's execution log, SQEM-042. This lists chat sessions, the record named as its
 * replacement.
 */
const History = () => {
  const navigate = useNavigate();
  const { chatSessions, updateChatSession, deleteChatSession } = useChatSessions();
  const { showToast } = useUI();
  const [external, setExternal] = useState<ExternalChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<HistoryEntry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchExternalChatHistory().then(setExternal).catch(() => { /* the sqemes half still shows */ }).finally(() => setLoading(false));
  }, []);

  const all = useMemo(() => buildHistory(chatSessions, external), [chatSessions, external]);
  const sources = useMemo(() => historySources(all), [all]);
  const shown = useMemo(() => filterHistory(all, { query, source: source ?? 'all' }), [all, query, source]);
  const pinned = shown.filter(e => e.pinned);
  const recent = shown.filter(e => !e.pinned);

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

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      if (toDelete.kind === 'sqemes') {
        await deleteChatSession(toDelete.id); // toasts on its own, success or failure
      } else {
        await deleteExternalChat(toDelete.id);
        setExternal(prev => prev.filter(x => x.id !== toDelete.id));
        showToast('Removed from your history', 'success');
      }
      setToDelete(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    } finally {
      setBusy(false);
    }
  };

  const row = (e: HistoryEntry) => (
    // SQEM-538 — the title is the button and its ::after covers the row; pin and delete sit above it.
    <li key={e.key} className="group relative flex items-center gap-3 px-3 py-2.5 rounded-control hover:bg-surface-sunken transition-colors">
      <div className="shrink-0 w-8 h-8 rounded-chip border border-line bg-surface-raised flex items-center justify-center">
        <ProviderIcon provider={e.icon} className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => open(e)}
          className="block w-full text-left text-sm font-medium text-ink break-words after:absolute after:inset-0 after:content-[''] after:rounded-control"
        >
          {e.title}
        </button>
        <p className="text-xs text-ink-subtle truncate">{e.label}{e.shared ? ' · shared' : ''} · {relTime(e.ts)}</p>
      </div>
      <button
        type="button"
        onClick={() => togglePin(e)}
        title={e.pinned ? 'Unpin' : 'Pin'}
        aria-label={e.pinned ? `Unpin ${e.title}` : `Pin ${e.title}`}
        className={`relative z-10 shrink-0 w-7 h-7 rounded-chip flex items-center justify-center transition-colors ${
          e.pinned ? 'text-accent' : 'text-ink-subtle reveal-on-hover hover:text-accent'
        }`}
      >
        <Pin className="w-4 h-4" fill={e.pinned ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        onClick={() => setToDelete(e)}
        title="Delete"
        aria-label={`Delete ${e.title}`}
        className="relative z-10 shrink-0 w-7 h-7 rounded-chip flex items-center justify-center text-ink-subtle reveal-on-hover hover:text-danger hover:bg-danger-soft transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );

  // Redesign C (as on Personas): the list is one card, rows are controls inside it.
  const section = (label: string, rows: HistoryEntry[]) => rows.length > 0 && (
    <section aria-label={label}>
      <h2 className="px-1 pb-2 text-xs font-semibold text-ink-subtle uppercase tracking-wider">{label}</h2>
      <ul className="rounded-card border border-line bg-surface-raised p-2 space-y-0.5">{rows.map(row)}</ul>
    </section>
  );

  return (
    // SQEM-563 — the padding of every list page, but a reading width: one column of chat titles reads
    // better narrow (max-w-3xl; 7xl like Personas was tried and dropped).
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-3xl mx-auto">
      <PageHeader
        title="History"
        subtitle="Your sqemes chats and the chats the browser extension recorded on ChatGPT, Claude and others."
      />
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="flex-1"><SearchInput value={query} onChange={setQuery} placeholder="Search chats..." /></div>
        {sources.length > 1 && (
          <SelectFilter icon={Filter} ariaLabel="Source" allLabel="All sources" options={sources} value={source} onChange={setSource} />
        )}
      </div>
      {loading && all.length === 0 ? (
        <div className="flex items-center gap-2 text-ink-subtle text-sm py-20 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="w-8 h-8" />}
          tone="brand"
          title="No chats yet"
          description="Chats you start in sqemes appear here, and so do the ChatGPT, Claude or Gemini chats the browser extension records."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="w-8 h-8" />}
          title="No chat matches"
          description="Try another word, or show all sources."
        />
      ) : (
        <div className="space-y-5">
          {section('Pinned', pinned)}
          {section('Recent Chats', recent)}
        </div>
      )}
      <ConfirmModal
        open={!!toDelete}
        title={toDelete?.kind === 'external' ? 'Remove from history?' : 'Delete chat?'}
        confirmLabel={toDelete?.kind === 'external' ? 'Remove' : 'Delete'}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => !busy && setToDelete(null)}
      >
        {toDelete && <p><span className="font-medium">{toDelete.title}</span> — {deleteWarning(toDelete)}</p>}
      </ConfirmModal>
    </div>
  );
};

export default History;
