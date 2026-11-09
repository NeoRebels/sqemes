import React, { useState } from 'react';
import { Clock, ShieldAlert } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Input } from './ui/Input';
import { m } from '../lib/i18n';
import { lineDiff, withContext } from '../lib/lineDiff';
import { decideChange, withdrawChange, ChangedSinceSubmitted } from '../lib/api/moderation';
import type { ChangePayload, PendingChange } from '../lib/moderation';

/**
 * SQEM-667 — a proposed change to a shared playbook or persona, where the object is opened.
 *
 * The author reads that the team still uses the released version, and may withdraw; after a rejection
 * the reason, and may discard. A moderator or admin sees every waiting change, compares it with the
 * released state and releases or rejects it. The database decides who may (decide_change); a release of
 * something changed since the submission asks first, then forces.
 */

/** The released state the change is compared with — the same keys a payload uses. */
export type ReleasedState = ChangePayload;

const FIELD_LABEL: Record<string, () => string> = {
  title: () => m.chg_field_title(), description: () => m.chg_field_description(), content: () => m.chg_field_content(),
  tag: () => m.chg_field_tag(), kind: () => m.chg_field_kind(), model: () => m.chg_field_model(), variables: () => m.chg_field_variables(),
  context_file_ids: () => m.chg_field_files(), tags: () => m.chg_field_tag(), connectors: () => m.chg_field_connectors(),
  routes: () => m.chg_field_routes(), access: () => m.chg_field_access(),
};

export function ChangeBanner({
  changes, myId, moderator, nameOf, released, onChanged,
}: {
  changes: PendingChange[];
  myId: string;
  moderator: boolean;
  nameOf: (userId: string) => string;
  released: ReleasedState;
  /** Something was withdrawn, released or rejected: reload. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = changes.find(c => c.author === myId);
  const others = moderator ? changes.filter(c => c.state === 'pending' && c.author !== myId) : [];
  if (!mine && others.length === 0) return null;

  const withdraw = async (id: string) => {
    setBusy(true);
    try { await withdrawChange(id); onChanged(); } finally { setBusy(false); }
  };

  return (
    <>
      {mine && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line bg-surface-sunken px-4 md:px-6 py-2.5" role="status">
          {mine.state === 'rejected' ? <ShieldAlert aria-hidden className="w-4 h-4 shrink-0 mt-0.5 text-ink-subtle" /> : <Clock aria-hidden className="w-4 h-4 shrink-0 mt-0.5 text-ink-subtle" />}
          <p className="text-xs text-ink flex-1 min-w-[12rem]">
            {mine.state === 'rejected'
              ? (mine.note ? m.chg_mine_rejected_reason({ reason: mine.note }) : m.chg_mine_rejected())
              : m.chg_mine_pending()}
          </p>
          <button type="button" disabled={busy} onClick={() => void withdraw(mine.id)}
            className="text-xs font-semibold text-ink-muted hover:text-ink-strong underline underline-offset-2 disabled:opacity-50">
            {mine.state === 'rejected' ? m.chg_discard() : m.mod_withdraw()}
          </button>
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-sunken px-4 md:px-6 py-2.5" role="status">
          <Clock aria-hidden className="w-4 h-4 shrink-0 text-ink-subtle" />
          <p className="text-xs text-ink flex-1 min-w-[12rem]">{m.chg_others_pending({ count: others.length })}</p>
          {others.map(c => (
            <button key={c.id} type="button" onClick={() => setOpen(c)}
              className="text-xs font-semibold px-3 py-1.5 rounded-control bg-accent-strong text-white hover:opacity-90">
              {m.chg_review_by({ name: nameOf(c.author) })}
            </button>
          ))}
        </div>
      )}
      {open && (
        <ChangeReviewModal change={open} authorName={nameOf(open.author)} released={released}
          onClose={() => setOpen(null)} onDecided={() => { setOpen(null); onChanged(); }} />
      )}
    </>
  );
}

export function ChangeReviewModal({
  change, authorName, released, onClose, onDecided,
}: {
  change: PendingChange;
  authorName: string;
  released: ReleasedState;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (release: boolean, force = false) => {
    setBusy(true);
    setError(null);
    try {
      await decideChange(change.id, release, release ? undefined : reason, force);
      onDecided();
    } catch (e) {
      if (e instanceof ChangedSinceSubmitted) setConflict(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const keys = Object.keys(change.payload) as (keyof ChangePayload)[];
  return (
    <Modal open onClose={onClose} size="lg" className="p-6">
      <h2 className="font-display text-lg font-semibold text-ink-strong">{m.chg_modal_title({ name: authorName })}</h2>
      <p className="text-xs text-ink-muted mt-1">{m.chg_modal_hint()}</p>
      <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {keys.length === 0 && <p className="text-sm text-ink-muted">{m.chg_no_fields()}</p>}
        {keys.map(k => (
          <section key={k}>
            <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-1">{(FIELD_LABEL[k] ?? (() => k))()}</p>
            <FieldDiff before={released[k]} after={change.payload[k]} />
          </section>
        ))}
      </div>
      {conflict && <p className="mt-4 text-sm text-warning" role="alert">{m.chg_conflict()}</p>}
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      {rejecting ? (
        <form className="mt-5 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void decide(false); }}>
          <label className="sr-only" htmlFor={`chg-reason-${change.id}`}>{m.mod_reject_reason()}</label>
          <Input id={`chg-reason-${change.id}`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
            placeholder={m.mod_reject_reason()} className="flex-1 min-w-[12rem]" autoFocus />
          <Button type="submit" variant="secondary" disabled={busy}>{m.mod_reject_confirm()}</Button>
          <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>{m.mod_cancel()}</Button>
        </form>
      ) : (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{m.mod_cancel()}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>{m.mod_reject()}</Button>
          {conflict
            ? <Button type="button" disabled={busy} onClick={() => void decide(true, true)}>{m.chg_release_anyway()}</Button>
            : <Button type="button" disabled={busy} onClick={() => void decide(true)}>{m.mod_release()}</Button>}
        </div>
      )}
    </Modal>
  );
}

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

/** Text fields line by line; everything else before → after. */
function FieldDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = withContext(lineDiff(asText(before), asText(after)), 2);
  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words rounded-control border border-line overflow-hidden">
      {rows.map((row, k) => row.type === 'gap' ? (
        <div key={k} className="px-3 py-1 text-ink-subtle bg-surface-sunken select-none">{m.vh_unchanged_lines({ count: row.count })}</div>
      ) : (
        <div key={k} className={`px-3 ${row.type === 'added' ? 'bg-success-soft text-ink-strong' : row.type === 'removed' ? 'bg-danger-soft text-ink-strong line-through decoration-danger/40' : 'text-ink'}`}>
          <span className="select-none text-ink-subtle mr-2">{row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}</span>
          {row.text || ' '}
        </div>
      ))}
    </pre>
  );
}

/** The list row's mark for an object with a waiting change (the author's own, or any for a moderator). */
export function ChangeBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="relative z-10 text-2xs font-bold px-2 py-0.5 bg-surface-sunken text-ink-muted rounded-lg uppercase tracking-wider shrink-0" title={m.chg_badge()}>
      {m.chg_badge()}
    </span>
  );
}
