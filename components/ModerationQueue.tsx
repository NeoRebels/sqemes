import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bot, Clock, Loader2, ShieldCheck, X } from 'lucide-react';
import KindBadge from './ui/KindBadge';
import SegmentedTabs from './ui/SegmentedTabs';
import { Input } from './ui/Input';
import { ChangeReviewModal } from './ChangeReview';
import { m, getLocale } from '../lib/i18n';
import { useModeration } from '../hooks/useModeration';
import { decideReview, fetchReleasedState, fetchReviewQueue, type QueueItem } from '../lib/api/moderation';
import type { ChangePayload, PendingChange } from '../lib/moderation';
import type { PromptKind, User, Workspace } from '../types';

/**
 * SQEM-669 — one list of everything waiting for review, for moderators and admins: new playbooks and
 * personas (SQEM-666) and changes to shared ones (SQEM-667). Built like the marketplace moderation of the
 * sqemes admins (`MarketplaceAdminEntry`): a quiet entry, a side panel, a decision per row. One entry, the same on
 * Playbooks, Personas and the Overview (no separate block, no list filter).
 *
 * ⛔ A moderator may review a change to something they cannot see (it is restricted to others): the list
 * says so (`canOpen`), and "Compare" reads the released state through `pending_change_released_state`,
 * which serves exactly that object while the change waits. Nothing else becomes visible.
 */
const PAGE = 50;

export default function ModerationQueue({
  workspace, user, onChanged,
}: {
  workspace: Workspace;
  user: User;
  /** A decision was made: the page reloads its states. */
  onChanged?: () => void;
}) {
  const moderation = useModeration(workspace, user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<'all' | 'new' | 'change'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState<{ change: PendingChange; released: ChangePayload; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!moderation.moderator) return;
    const page = await fetchReviewQueue(workspace.id, PAGE, 0);
    setItems(page);
    setMore(page.length === PAGE);
  }, [workspace.id, moderation.moderator]);
  useEffect(() => { void load(); }, [load]);

  if (!moderation.moderator || !items || items.length === 0) return null;

  const nameOf = (uid: string | null) => (uid && workspace.members.find(u => u.id === uid)?.name) || m.flt_owner_gone();
  const keyOf = (q: QueueItem) => q.changeId ?? `${q.kind}:${q.id}`;
  const shown = items.filter(q => tab === 'all' || q.type === tab);
  const done = (q: QueueItem) => {
    setItems(prev => (prev ?? []).filter(x => keyOf(x) !== keyOf(q)));
    setRejecting(null);
    setReason('');
    onChanged?.();
  };
  const decideNew = async (q: QueueItem, release: boolean) => {
    setBusyId(keyOf(q));
    setError(null);
    try { await decideReview(q.kind, q.id, release, release ? undefined : reason); done(q); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  };
  const compare = async (q: QueueItem) => {
    if (!q.changeId) return;
    setBusyId(keyOf(q));
    try {
      const released = await fetchReleasedState(q.changeId);
      if (!released) { setError(m.mq_compare_failed()); return; }
      setComparing({
        name: nameOf(q.author), released,
        change: { id: q.changeId, kind: q.kind, objectId: q.id, author: q.author ?? '', payload: q.payload ?? {},
          baseUpdatedAt: q.baseUpdatedAt, state: 'pending', note: null, createdAt: q.submittedAt, updatedAt: q.submittedAt },
      });
    } finally { setBusyId(null); }
  };
  const date = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-line-strong text-ink hover:border-ink-subtle">
        <ShieldCheck aria-hidden className="w-4 h-4" /> {m.mq_open({ count: items.length })}
      </button>

      {open && (
        <div role="presentation" className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex justify-end animate-fade-in" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label={m.mq_title()} onClick={e => e.stopPropagation()}
            className="w-full max-w-xl h-full bg-surface-raised border-l border-line shadow-xl flex flex-col">
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
              <h2 className="font-display text-lg font-semibold text-ink-strong flex items-center gap-2">
                <ShieldCheck aria-hidden className="w-5 h-5 text-ink-subtle" /> {m.mq_title()}
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={m.mod_cancel()} className="p-2 rounded-control text-ink-subtle hover:text-ink-strong hover:bg-surface-sunken">
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="px-5 pt-4">
              <SegmentedTabs<'all' | 'new' | 'change'> value={tab} onChange={setTab}
                tabs={[{ value: 'all', label: m.mq_tab_all() }, { value: 'new', label: m.mq_tab_new() }, { value: 'change', label: m.mq_tab_changes() }]} />
            </div>
            {error && <p className="px-5 pt-3 text-sm text-danger" role="alert">{error}</p>}
            <ul className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {shown.length === 0 && <li className="text-sm text-ink-muted">{m.mq_empty()}</li>}
              {shown.map(q => {
                const k = keyOf(q);
                const busy = busyId === k;
                return (
                  <li key={k} className="rounded-card border border-line bg-surface p-3">
                    <div className="flex items-start gap-3">
                      {q.subkind === 'persona' ? <Bot aria-hidden className="w-4 h-4 mt-0.5 text-accent shrink-0" /> : <KindBadge kind={q.subkind as PromptKind} />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-strong truncate">{q.title || m.pe_untitled_playbook()}</p>
                        <p className="text-xs text-ink-muted flex items-center gap-1.5">
                          <Clock aria-hidden className="w-3 h-3" />
                          {(q.type === 'new' ? m.mq_new_by : m.mq_change_by)({ name: nameOf(q.author) })} · {date(q.submittedAt)}
                        </p>
                        {!q.canOpen && <p className="text-xs text-ink-subtle mt-0.5">{m.mq_no_access()}</p>}
                      </div>
                    </div>
                    {rejecting === k ? (
                      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={e => {
                        e.preventDefault();
                        if (q.type === 'new') void decideNew(q, false);
                      }}>
                        <label className="sr-only" htmlFor={`mq-${k}`}>{m.mod_reject_reason()}</label>
                        <Input id={`mq-${k}`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
                          placeholder={m.mod_reject_reason()} className="flex-1 min-w-[10rem]" autoFocus />
                        <button type="submit" disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-control border border-line-strong text-ink disabled:opacity-50">{m.mod_reject_confirm()}</button>
                        <button type="button" onClick={() => { setRejecting(null); setReason(''); }} className="text-xs text-ink-muted hover:text-ink-strong">{m.mod_cancel()}</button>
                      </form>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {q.canOpen && (
                          <button type="button" onClick={() => navigate(q.kind === 'template' ? `/playbooks/${q.id}/edit` : `/personas/${q.id}/edit`)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-control border border-line-strong text-ink hover:border-ink-subtle">{m.mq_open_item()}</button>
                        )}
                        {q.type === 'change' ? (
                          <button type="button" disabled={busy} onClick={() => void compare(q)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-control bg-accent-strong text-white hover:opacity-90 disabled:opacity-50">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : m.mq_compare()}
                          </button>
                        ) : (
                          <>
                            <button type="button" disabled={busy} onClick={() => void decideNew(q, true)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-control bg-accent-strong text-white hover:opacity-90 disabled:opacity-50">{m.mod_release()}</button>
                            <button type="button" disabled={busy} onClick={() => setRejecting(k)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-control border border-line-strong text-ink hover:border-ink-subtle disabled:opacity-50">{m.mod_reject()}</button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {more && tab === 'all' && (
                <li>
                  <button type="button" onClick={async () => {
                    const page = await fetchReviewQueue(workspace.id, PAGE, items.length);
                    setItems(prev => [...(prev ?? []), ...page]);
                    setMore(page.length === PAGE);
                  }} className="text-sm font-semibold text-accent hover:underline">{m.mq_more()}</button>
                </li>
              )}
            </ul>
          </aside>
        </div>
      )}

      {comparing && (
        <ChangeReviewModal change={comparing.change} authorName={comparing.name} released={comparing.released}
          onClose={() => setComparing(null)}
          onDecided={() => {
            const q = items.find(x => x.changeId === comparing.change.id);
            setComparing(null);
            if (q) done(q);
          }} />
      )}
    </>
  );
}
