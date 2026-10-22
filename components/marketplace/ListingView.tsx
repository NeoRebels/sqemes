// SQEM-258 — everything a marketplace listing page shows, and nothing about where it gets it.
//
// **No store hooks live here on purpose.** The page exists in two versions — signed in
// (`pages/MarketplaceTemplate.tsx`) and public (`pages/PublicListing.tsx`) — and the public one must
// render without `AppProvider` ever mounting. The store has never run without a session, and the one
// URL a stranger sees is the wrong place to find out how it behaves. An absent handler is how this
// component learns an action is unavailable; it never asks who is looking.
import { useState, type ReactNode } from 'react';
import type { LibraryTemplate, Step, Variable } from '../../types';
import KindBadge from '../ui/KindBadge';
import FullScreenExit from '../ui/FullScreenExit';
import sqemesIcon from '../../assets/sqemes-icon.svg';
import { FilePlus, Flag, Loader2, FileText, ArrowUpRight, Sparkles, Flame, Snowflake, Download } from 'lucide-react';

export type ListingViewProps = {
  listing: LibraryTemplate;
  /** Absent on the public page: `/library` is behind the sign-in wall, so "Back to Marketplace"
   *  would walk a signed-out visitor into it (SQEM-258). */
  onExit?: () => void;

  /** Votes. Without `onVote` the score still shows — it is content — but the buttons do not. */
  score: number;
  myVote?: number;
  onVote?: (value: 1 | -1) => void;

  /** Each action is hidden when its handler is absent. */
  onReport?: () => void;
  onCopy?: () => void;
  copying?: boolean;
  onAdapt?: () => void;
  adapting?: boolean;
  adaptLabel?: string;
  adaptDisabled?: boolean;
  adaptTitle?: string;
  onDownload?: () => void;
  downloading?: boolean;

  /** Shown under the actions when there is something to offer someone without an account. */
  offer?: ReactNode;
  /** The report dialog, owned by the signed-in page. */
  children?: ReactNode;
};

export default function ListingView({
  listing, onExit,
  score, myVote = 0, onVote,
  onReport, onCopy, copying, onAdapt, adapting, adaptLabel, adaptDisabled, adaptTitle,
  onDownload, downloading, offer, children,
}: ListingViewProps) {
  const body = listing.content || (listing.steps as Step[] | undefined)?.[0]?.content || '';
  const fileNames = listing.preview?.fileNames ?? [];
  // SQEM-519 — a listing that brings scripts, other files or web addresses says so before it is added,
  // and the copy waits for a second click. Text-only listings add in one click, as before.
  const summary = listing.copySummary;
  const needsConfirm = !!summary && (summary.scripts > 0 || summary.binaries > 0 || summary.hosts.length > 0);
  const [confirming, setConfirming] = useState(false);
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  return (
    // Owns its scroll (SQEM-191): this route renders outside Layout, and index.css sets
    // `overflow: hidden` on html/body — min-h-screen would grow past the viewport and be
    // clipped, not scrolled. A Tailwind height class (not a raw `100vh`) keeps the staging-banner
    // override working — `index.css` overrides `.h-screen` *and* `.h-dvh`, and SQEM-360 moved this
    // to `h-dvh` so the bottom no longer sits behind iOS Safari's toolbar.
    <div className="h-dvh overflow-y-auto bg-surface">
      <div className="max-w-3xl mx-auto px-6 pt-6 flex items-center justify-between">
        {onExit
          ? <FullScreenExit label="Back to Marketplace" onExit={onExit} escapeEnabled />
          : <span />}
        <div className="flex items-center gap-2 text-ink-subtle">
          <img src={sqemesIcon} alt="sqemes" className="w-5 h-5" />
          <span className="text-sm font-bold tracking-tight text-ink">sqemes</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <KindBadge kind={listing.kind} />
          <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-surface-sunken text-ink-muted">{listing.category}</span>
          {listing.status === 'pending' && <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-warning-soft text-ink-strong">Pending review</span>}
        </div>
        <h1 className="font-display text-3xl font-semibold text-ink-strong tracking-tight">{listing.title}</h1>
        {/* SQEM-258 — was text-lg; the description is supporting text, not a second headline. */}
        {listing.description && <p className="text-base text-ink-muted mt-3 leading-relaxed">{listing.description}</p>}

        {/* Row 1 — what this listing is: rating, contents, and the way to flag it.
            SQEM-258 — "Uses" is gone. The counter is not broken (it increments on copy), the number
            is simply honest: 21 of 22 production listings sit at 0, and printing that advertises
            that nothing here is used. The column and its increment stay; the display can come back
            when the numbers say something. */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {onVote ? (
            <div className="inline-flex items-center rounded-xl border border-line-strong overflow-hidden">
              <button onClick={() => onVote(1)} title="Hot" className={`inline-flex items-center px-3 py-2 transition-colors ${myVote === 1 ? 'text-danger bg-danger-soft' : 'text-ink-subtle hover:bg-surface-sunken'}`}>
                <Flame className="w-4 h-4" />
              </button>
              <span className={`px-2 text-sm font-bold tabular-nums ${score > 0 ? 'text-danger' : score < 0 ? 'text-sky-500' : 'text-ink-subtle'}`}>{score > 0 ? `+${score}` : score}°</span>
              <button onClick={() => onVote(-1)} title="Cold" className={`inline-flex items-center px-3 py-2 transition-colors ${myVote === -1 ? 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'text-ink-subtle hover:bg-surface-sunken'}`}>
                <Snowflake className="w-4 h-4" />
              </button>
            </div>
          ) : (
            // Read-only: the number is worth showing, the buttons need an identity to attach a vote to.
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold tabular-nums ${score > 0 ? 'text-danger' : score < 0 ? 'text-sky-500' : 'text-ink-subtle'}`} title="Community rating">
              {score < 0 ? <Snowflake className="w-4 h-4" /> : <Flame className="w-4 h-4" />} {score > 0 ? `+${score}` : score}°
            </span>
          )}

          {fileNames.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-subtle"><FileText className="w-4 h-4" /> {fileNames.length} file{fileNames.length === 1 ? '' : 's'}</span>
          )}

          {onReport && (
            <button onClick={onReport} className="inline-flex items-center gap-1.5 text-sm text-ink-subtle hover:text-danger font-semibold transition-colors">
              <Flag className="w-4 h-4" /> Report
            </button>
          )}
        </div>

        {/* Row 2 — what you can do with it. */}
        <div className="flex flex-wrap items-center gap-3 mt-6">
          {onCopy && (
            <button onClick={needsConfirm ? () => setConfirming(true) : onCopy} disabled={copying || adapting || confirming} className="inline-flex items-center gap-2 px-6 py-3 bg-accent-strong hover:opacity-90 text-white rounded-xl font-bold text-sm transition-all shadow-lg disabled:opacity-50">
              {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />} Add to playbooks
            </button>
          )}
          {onAdapt && (
            <button onClick={onAdapt} disabled={copying || adapting || adaptDisabled} title={adaptTitle} className="inline-flex items-center gap-2 px-5 py-3 bg-accent-strong hover:opacity-90 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {adapting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {adaptLabel}
            </button>
          )}
          {/* An outline button, not a text link (SQEM-415, UX test 2026-09-16): underlined beside two
              filled buttons it read as fine print — a tester looking for the way to take a playbook
              *out* of Sqemes did not find it. Outline keeps the hierarchy (it is an alternative to
              taking the template in, not a competing primary action) while still looking like a
              control.
              SQEM-302 — shown for every listing now. It used to be skills only, because the download
              was an Agent Skill folder and a prompt's variables cannot be expressed as a SKILL.md.
              The sqemes bundle expresses both kinds, so the restriction lost the reason it was
              built on. */}
          {onDownload && (
            <button
              onClick={onDownload}
              disabled={downloading}
              title={fileNames.length ? `A .sqemes.zip with ${fileNames.length} file${fileNames.length === 1 ? '' : 's'}` : 'A .sqemes.zip — this listing carries no files'}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold border border-line-strong text-ink hover:border-accent hover:text-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download Playbook
            </button>
          )}
        </div>

        {onCopy && confirming && summary && (
          <div className="mt-4 rounded-2xl border border-warning/40 bg-warning-soft p-5 text-sm text-ink" data-testid="copy-summary">
            <h2 className="font-bold mb-2">Before you add it</h2>
            <p>
              This playbook brings {n(summary.scripts, 'script', 'scripts')}, {n(summary.binaries, 'other file', 'other files')} and {n(summary.textFiles, 'text file', 'text files')}.
            </p>
            {summary.scripts > 0 && (
              <p className="mt-2">Scripts do nothing on their own. An AI agent that can run code may run them when it uses this playbook, so read them before you use it there.</p>
            )}
            {summary.hosts.length > 0 && (
              <p className="mt-2 break-words">It names these web addresses: <span className="font-mono text-xs">{summary.hosts.join(', ')}</span></p>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={() => { setConfirming(false); onCopy(); }} disabled={copying} className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50">
                <FilePlus className="w-4 h-4" /> Add to playbooks
              </button>
              <button onClick={() => setConfirming(false)} className="px-5 py-2.5 rounded-xl text-sm font-bold text-ink hover:bg-surface-raised/60">Cancel</button>
            </div>
          </div>
        )}

        {offer}

        {/* What you get — transparency */}
        {fileNames.length ? (
          <div className="mt-8 rounded-2xl bg-surface-raised border border-line shadow-soft p-5">
            {/* SQEM-415 — "this copy" was read as a copy of something else; the word everywhere
                else on this page is playbook. */}
            <h2 className="text-sm font-bold text-ink mb-3">What comes with this playbook</h2>
            {fileNames.length > 0 && (
              // SQEM-258 — the list is capped and scrolls: a skill import can bring 151 files, and
              // an uncapped chip list pushes the preview and everything below it off the page. The
              // heading and the skills note stay outside the scroll, so the context does not scroll
              // away with the content. `max-h-96` matches the preview block below rather than
              // inventing a second height next to it.
              <div className="flex flex-wrap gap-1.5 max-h-96 overflow-y-auto">
                {fileNames.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-surface-sunken border border-line rounded-lg px-2 py-1 text-ink"><FileText className="w-3 h-3" /> {n}</span>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Body preview */}
        {body && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-ink mb-2">Preview</h2>
            <pre className="rounded-2xl bg-surface-raised border border-line shadow-soft p-5 text-sm text-ink whitespace-pre-wrap break-words max-h-96 overflow-y-auto font-sans leading-relaxed">{body}</pre>
          </div>
        )}

        {/* Variables */}
        {listing.variables?.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-ink mb-2">Variables</h2>
            <div className="flex flex-wrap gap-1.5">
              {(listing.variables as Variable[]).map(v => <span key={v.id} className="text-xs font-mono bg-accent-soft text-accent rounded-lg px-2 py-1">{`{{${v.name}}}`}</span>)}
            </div>
          </div>
        )}

        {/* Footer — soft growth loop */}
        <div className="mt-14 pt-6 border-t border-line flex items-center justify-center">
          <a href="https://sqemes.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-ink-subtle hover:text-accent transition-colors">
            <img src={sqemesIcon} alt="" className="w-4 h-4 opacity-70" /> Made with sqemes <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {children}
    </div>
  );
}

/** The empty/failed state, shared so both pages fail the same way. */
export function ListingUnavailable({ onExit }: { onExit?: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface text-center px-6">
      <p className="text-ink-muted">This playbook isn&apos;t available.</p>
      {/* SQEM-208 — the dead-end state needs the exit most of all: there is nothing else here.
          Except when there is nowhere to send them: a signed-out visitor has no marketplace to go
          back to, and an exit into the sign-in wall is not an exit (SQEM-258). */}
      {onExit && <FullScreenExit label="Back to Marketplace" onExit={onExit} escapeEnabled />}
    </div>
  );
}

export function ListingLoading() {
  return <div className="min-h-screen flex items-center justify-center bg-surface"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
}
