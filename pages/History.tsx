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
import Checkbox from '../components/ui/Checkbox';
import BulkActionBar from '../components/ui/BulkActionBar';
import { m } from '../lib/i18n';
import { fetchExternalChatHistory, setExternalChatPinned, deleteExternalChat, type ExternalChat } from '../lib/api/externalChatHistory';
import { buildHistory, filterHistory, historySources, deleteWarning, bulkDeleteWarning, relTime, type HistoryEntry } from '../lib/historyItems';

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
  const { chatSessions, updateChatSession, deleteChatSession, deleteChatSessions } = useChatSessions();
  const { showToast } = useUI();
  const [external, setExternal] = useState<ExternalChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<HistoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  // SQEM-576 — multi-select by entry key (sqemes and extension ids could collide; keys cannot).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    fetchExternalChatHistory().then(setExternal).catch(() => { /* the sqemes half still shows */ }).finally(() => setLoading(false));
  }, []);

  const all = useMemo(() => buildHistory(chatSessions, external), [chatSessions, external]);
  const sources = useMemo(() => historySources(all), [all]);
  const shown = useMemo(() => filterHistory(all, { query, source: source ?? 'all' }), [all, query, source]);
  const pinned = shown.filter(e => e.pinned);
  const recent = shown.filter(e => !e.pinned);
  // Only what is visible counts as selected: a search that hides a row must not leave it in a delete.
  const selected = shown.filter(e => selectedKeys.has(e.key));
  const allSelected = shown.length > 0 && selected.length === shown.length;
  const toggleSelect = (key: string) => setSelectedKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleSelectAll = () => setSelectedKeys(allSelected ? new Set() : new Set(shown.map(e => e.key)));

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
        showToast(m.hi_removed(), 'success');
      }
      setToDelete(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : m.hi_delete_failed(), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (!bulkDelete) return;
    setBusy(true);
    try {
      const own = bulkDelete.filter(e => e.kind === 'sqemes').map(e => e.id);
      const ext = bulkDelete.filter(e => e.kind === 'external').map(e => e.id);
      const sq = own.length ? await deleteChatSessions(own) : { deleted: 0, failed: 0 };
      const results = await Promise.allSettled(ext.map(id => deleteExternalChat(id)));
      const gone = new Set(ext.filter((_, i) => results[i].status === 'fulfilled'));
      setExternal(prev => prev.filter(x => !gone.has(x.id)));
      const failed = sq.failed + (ext.length - gone.size);
      const deleted = sq.deleted + gone.size;
      if (failed) showToast(m.hi_bulk_partial({ deleted, failed }), 'error');
      else showToast(m.hi_bulk_done({ deleted }), 'success');
      setSelectedKeys(new Set());
      setBulkDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const row = (e: HistoryEntry) => (
    // SQEM-538 — the title is the button and its ::after covers the row; pin and delete sit above it.
    <li key={e.key} className="group relative flex items-center gap-3 px-3 py-2.5 rounded-control hover:bg-surface-sunken transition-colors">
      {/* SQEM-576 — as on Personas: padded label gives the checkbox a hit margin over the row button. */}
      <label aria-label={m.hi_select({ title: e.title })} className="relative z-10 p-1 -m-1 cursor-pointer">
        <Checkbox
          checked={selectedKeys.has(e.key)}
          onChange={() => toggleSelect(e.key)}
          align="center"
          className={selectedKeys.has(e.key) || selected.length > 0 ? 'opacity-100' : 'reveal-on-hover'}
        />
      </label>
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
        <p className="text-xs text-ink-subtle truncate">{e.label}{e.shared ? m.hi_shared() : ''} · {relTime(e.ts)}</p>
      </div>
      <button
        type="button"
        onClick={() => togglePin(e)}
        title={e.pinned ? m.hi_unpin() : m.hi_pin()}
        aria-label={e.pinned ? m.hi_unpin_x({ title: e.title }) : m.hi_pin_x({ title: e.title })}
        className={`relative z-10 shrink-0 w-7 h-7 rounded-chip flex items-center justify-center transition-colors ${
          e.pinned ? 'text-accent' : 'text-ink-subtle reveal-on-hover hover:text-accent'
        }`}
      >
        <Pin className="w-4 h-4" fill={e.pinned ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        onClick={() => setToDelete(e)}
        title={m.hi_delete()}
        aria-label={m.hi_delete_x({ title: e.title })}
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
        title={m.nav_history()}
        subtitle={m.hi_subtitle()}
      />
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="flex-1"><SearchInput value={query} onChange={setQuery} placeholder={m.hi_search()} /></div>
        {sources.length > 1 && (
          <SelectFilter icon={Filter} ariaLabel={m.hi_source()} allLabel={m.hi_all_sources()} options={sources} value={source} onChange={setSource} />
        )}
      </div>
      {loading && all.length === 0 ? (
        <div className="flex items-center gap-2 text-ink-subtle text-sm py-20 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> {m.hi_loading()}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="w-8 h-8" />}
          tone="brand"
          title={m.hi_empty_title()}
          description={m.hi_empty_desc()}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="w-8 h-8" />}
          title={m.hi_nomatch_title()}
          description={m.hi_nomatch_desc()}
        />
      ) : (
        <div className="space-y-5">
          {selected.length > 0 && (
            <BulkActionBar
              count={selected.length}
              total={shown.length}
              allSelected={allSelected}
              onToggleSelectAll={toggleSelectAll}
              onDelete={() => setBulkDelete(selected)}
              onClear={() => setSelectedKeys(new Set())}
              noun="chat"
            />
          )}
          {section(m.hi_pinned(), pinned)}
          {section(m.sb_recent(), recent)}
        </div>
      )}
      <ConfirmModal
        open={!!toDelete}
        title={toDelete?.kind === 'external' ? m.hi_remove_title() : m.hi_delete_title()}
        confirmLabel={toDelete?.kind === 'external' ? m.hi_remove() : m.hi_delete()}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => !busy && setToDelete(null)}
      >
        {toDelete && <p><span className="font-medium">{toDelete.title}</span> — {deleteWarning(toDelete)}</p>}
      </ConfirmModal>
      <ConfirmModal
        open={!!bulkDelete}
        title={m.hi_bulk_title({ count: bulkDelete?.length ?? 0 })}
        confirmLabel={m.hi_delete()}
        busy={busy}
        onConfirm={confirmBulkDelete}
        onClose={() => !busy && setBulkDelete(null)}
      >
        {bulkDelete && <p>{bulkDeleteWarning(bulkDelete)}</p>}
      </ConfirmModal>
    </div>
  );
};

export default History;
