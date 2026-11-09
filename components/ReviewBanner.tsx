import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import { m } from '../lib/i18n';
import { Input } from './ui/Input';
import { decideReview, submitForReview } from '../lib/api/moderation';
import type { ReviewInfo, ReviewKind, ReviewState } from '../lib/moderation';

/**
 * SQEM-666 — the review state of one playbook or persona, said where it is opened (editor, preview).
 *
 * The owner reads where it stands and can withdraw a submission; a moderator or admin releases or
 * rejects a pending one, with a reason for a rejection. Submitting itself happens on Save (the editor
 * knows the chosen access). The database decides who may do what; a refused call shows its message.
 */
export default function ReviewBanner({
  kind, id, review, isOwner, moderator, onChanged, privateAccess,
}: {
  kind: ReviewKind;
  id: string;
  review: ReviewInfo | null | undefined;
  isOwner: boolean;
  moderator: boolean;
  /** The new state after an action; null = released. */
  onChanged: (next: ReviewInfo | null) => void;
  /** The owner chose "Only me" — then nothing needs submitting, and the text says so. */
  privateAccess?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!review) return null;
  const decides = moderator && !isOwner && review.state === 'pending';
  if (!isOwner && !decides) return null;

  const run = async (fn: () => Promise<ReviewInfo | null>) => {
    setBusy(true);
    setError(null);
    try { onChanged(await fn()); setRejecting(false); setReason(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const text: Record<ReviewState, string> = {
    draft: privateAccess ? m.mod_banner_draft_private() : m.mod_banner_draft(),
    pending: decides ? m.mod_banner_pending_moderator() : m.mod_banner_pending(),
    rejected: review.note ? m.mod_banner_rejected_reason({ reason: review.note }) : m.mod_banner_rejected(),
  };
  const Icon = review.state === 'rejected' ? ShieldAlert : review.state === 'pending' ? Clock : ShieldCheck;

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line bg-surface-sunken px-4 md:px-6 py-2.5" role="status">
      <Icon aria-hidden className="w-4 h-4 shrink-0 mt-0.5 text-ink-subtle" />
      <p className="text-xs text-ink flex-1 min-w-[12rem]">{text[review.state]}</p>
      {isOwner && review.state === 'pending' && (
        <button type="button" disabled={busy} onClick={() => run(async () => ({ state: (await submitForReview(kind, id, true)) ?? 'draft', note: null }))}
          className="text-xs font-semibold text-ink-muted hover:text-ink-strong underline underline-offset-2 disabled:opacity-50">
          {m.mod_withdraw()}
        </button>
      )}
      {decides && !rejecting && (
        <span className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => run(async () => { await decideReview(kind, id, true); return null; })}
            className="text-xs font-semibold px-3 py-1.5 rounded-control bg-accent-strong text-white hover:opacity-90 disabled:opacity-50">
            {m.mod_release()}
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-control border border-line-strong text-ink hover:border-ink-subtle disabled:opacity-50">
            {m.mod_reject()}
          </button>
        </span>
      )}
      {decides && rejecting && (
        <form className="w-full flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { await decideReview(kind, id, false, reason); return { state: 'rejected', note: reason.trim() || null }; }); }}>
          <label className="sr-only" htmlFor={`reject-${id}`}>{m.mod_reject_reason()}</label>
          <Input id={`reject-${id}`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder={m.mod_reject_reason()}
            className="flex-1 min-w-[12rem]" autoFocus />
          <button type="submit" disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-control border border-line-strong text-ink hover:border-ink-subtle disabled:opacity-50">{m.mod_reject_confirm()}</button>
          <button type="button" onClick={() => { setRejecting(false); setReason(''); }} className="text-xs text-ink-muted hover:text-ink-strong">{m.mod_cancel()}</button>
        </form>
      )}
      {error && <p className="w-full text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** The short form for a list row: what the owner (or a moderator, for pending) needs to know at a glance. */
export function ReviewBadge({ state }: { state: ReviewState | null }) {
  if (!state) return null;
  const label = state === 'pending' ? m.mod_badge_pending() : state === 'rejected' ? m.mod_badge_rejected() : m.mod_badge_draft();
  return (
    <span className="relative z-10 text-2xs font-bold px-2 py-0.5 bg-surface-sunken text-ink-muted rounded-lg uppercase tracking-wider shrink-0" title={label}>
      {label}
    </span>
  );
}
