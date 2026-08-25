import React, { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Button from './ui/Button';
import {
  LEGAL_DOCUMENTS,
  publishedDocuments,
  pendingAcceptances,
  acceptanceRows,
  type LegalDocument,
} from '../lib/legal';

/**
 * SQEM-264 — nobody uses the product without having agreed to the documents that govern it.
 *
 * **Placed around the authenticated app rather than in the sign-up form, and that is the whole
 * design.** The form is one door of four: Google and GitHub sign-in never render it, an invited
 * member never sees it, and every account that existed before this shipped never saw it either. A
 * checkbox on the form would have covered the door that was easiest to see and left the other three
 * open — including the one that matters most commercially, the existing customers.
 *
 * It is also the mechanism a later version bump needs. Amending terms by announcing them and calling
 * silence agreement does not hold against consumers (BGH XI ZR 26/20), and the product owner chose on
 * 2026-08-21 to serve consumer law rather than restrict the product to businesses. So agreement has to
 * be **active and recorded** — which is this component, run again whenever a version changes.
 *
 * ⚠️ **While nothing is published it renders its children and issues no query at all.** Both versions
 * in `lib/legal.ts` are `null` today. Do not "simplify" the early return away: without it, every
 * authenticated load pays for a request whose answer is structurally known.
 */
const LegalGate = ({ userId, children }: { userId: string; children: React.ReactNode }) => {
  const live = publishedDocuments(LEGAL_DOCUMENTS);

  // Nothing published → nothing to check, nothing to ask, no round trip.
  if (live.length === 0) return <>{children}</>;

  return <LegalGateActive userId={userId} live={live}>{children}</LegalGateActive>;
};

const LegalGateActive = ({
  userId, live, children,
}: { userId: string; live: LegalDocument[]; children: React.ReactNode }) => {
  const [pending, setPending] = useState<LegalDocument[] | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('legal_acceptances')
        .select('document, version')
        .eq('user_id', userId);
      if (cancelled) return;
      if (error) {
        // Failing open is the deliberate choice: a database hiccup must not lock a paying customer
        // out of their own workspace. The record is evidence of agreement, not the access control —
        // and an unrecorded acceptance is recoverable, a locked-out customer at 09:00 is not.
        setPending([]);
        return;
      }
      setPending(pendingAcceptances(data ?? [], live));
    })();
    return () => { cancelled = true; };
  }, [userId, live]);

  // Unknown yet — render nothing rather than flashing either state.
  if (pending === null) return null;
  if (pending.length === 0) return <>{children}</>;

  const accept = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('legal_acceptances')
      .upsert(acceptanceRows(userId, pending), { onConflict: 'user_id,document,version', ignoreDuplicates: true });
    setSaving(false);
    if (error) { setError('Could not save your agreement. Please try again.'); return; }
    setPending([]);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-8">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-brand-600" aria-hidden="true" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {pending.length === live.length ? 'Before you start' : 'We have updated our terms'}
          </h1>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
          {pending.length === live.length
            ? 'Please read and agree to the documents below to use Sqemes.'
            : 'Please read and agree to the updated documents below to continue.'}
        </p>

        <ul className="space-y-2 mb-6">
          {pending.map(d => (
            <li key={d.id}>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                {d.label}
              </a>
              <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">version {d.version}</span>
            </li>
          ))}
        </ul>

        {/* One checkbox, and it starts unticked. A pre-ticked box is not agreement — the same rule
            that applies to consent under the GDPR applies to the impression this screen gives. */}
        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-slate-700 dark:text-slate-200">
            I have read and agree to the {pending.length > 1 ? 'documents' : 'document'} above.
          </span>
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

        <Button onClick={accept} disabled={!checked || saving} className="w-full py-2.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Agree and continue'}
        </Button>

        <p className="text-2xs text-slate-400 dark:text-slate-500 mt-4 text-center">
          We record which version you agreed to and when.
        </p>
      </div>
    </div>
  );
};

export default LegalGate;
