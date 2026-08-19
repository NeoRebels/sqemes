// SQEM-258 — everything a marketplace listing page shows, and nothing about where it gets it.
//
// **No store hooks live here on purpose.** The page exists in two versions — signed in
// (`pages/MarketplaceTemplate.tsx`) and public (`pages/PublicListing.tsx`) — and the public one must
// render without `AppProvider` ever mounting. The store has never run without a session, and the one
// URL a stranger sees is the wrong place to find out how it behaves. An absent handler is how this
// component learns an action is unavailable; it never asks who is looking.
import type { ReactNode } from 'react';
import type { LibraryTemplate, Step, Variable } from '../../types';
import KindBadge from '../ui/KindBadge';
import FullScreenExit from '../ui/FullScreenExit';
import sqemesIcon from '../../assets/sqemes-icon.svg';
import { FilePlus, Flag, Loader2, FileText, Wand2, ArrowUpRight, Sparkles, Flame, Snowflake, Download } from 'lucide-react';

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
  const body = listing.content || (listing.steps as Step[] | undefined)?.[0]?.content || listing.systemInstruction || '';
  const fileNames = listing.preview?.fileNames ?? [];

  return (
    // Owns its scroll (SQEM-191): this route renders outside Layout, and index.css sets
    // `overflow: hidden` on html/body — min-h-screen would grow past the viewport and be
    // clipped, not scrolled. h-screen (not 100vh) keeps the staging-banner override working.
    <div className="h-screen overflow-y-auto bg-slate-50 dark:bg-slate-900">
      <div className="max-w-3xl mx-auto px-6 pt-6 flex items-center justify-between">
        {onExit
          ? <FullScreenExit label="Back to Marketplace" onExit={onExit} escapeEnabled />
          : <span />}
        <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
          <img src={sqemesIcon} alt="Sqemes" className="w-5 h-5" />
          <span className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-300">Sqemes</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <KindBadge kind={listing.kind} />
          <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{listing.category}</span>
          {listing.status === 'pending' && <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600">Pending review</span>}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{listing.title}</h1>
        {/* SQEM-258 — was text-lg; the description is supporting text, not a second headline. */}
        {listing.description && <p className="text-base text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">{listing.description}</p>}

        {/* Row 1 — what this listing is: rating, contents, and the way to flag it.
            SQEM-258 — "Uses" is gone. The counter is not broken (it increments on copy), the number
            is simply honest: 21 of 22 production listings sit at 0, and printing that advertises
            that nothing here is used. The column and its increment stay; the display can come back
            when the numbers say something. */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {onVote ? (
            <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button onClick={() => onVote(1)} title="Hot" className={`inline-flex items-center px-3 py-2 transition-colors ${myVote === 1 ? 'text-red-500 bg-red-50 dark:bg-red-900/20' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                <Flame className="w-4 h-4" />
              </button>
              <span className={`px-2 text-sm font-bold tabular-nums ${score > 0 ? 'text-red-500' : score < 0 ? 'text-sky-500' : 'text-slate-400'}`}>{score > 0 ? `+${score}` : score}°</span>
              <button onClick={() => onVote(-1)} title="Cold" className={`inline-flex items-center px-3 py-2 transition-colors ${myVote === -1 ? 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                <Snowflake className="w-4 h-4" />
              </button>
            </div>
          ) : (
            // Read-only: the number is worth showing, the buttons need an identity to attach a vote to.
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold tabular-nums ${score > 0 ? 'text-red-500' : score < 0 ? 'text-sky-500' : 'text-slate-400'}`} title="Community rating">
              {score < 0 ? <Snowflake className="w-4 h-4" /> : <Flame className="w-4 h-4" />} {score > 0 ? `+${score}` : score}°
            </span>
          )}

          {fileNames.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500"><FileText className="w-4 h-4" /> {fileNames.length} file{fileNames.length === 1 ? '' : 's'}</span>
          )}
          {!!listing.preview?.skillCount && (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500"><Wand2 className="w-4 h-4" /> {listing.preview.skillCount} skill{listing.preview.skillCount === 1 ? '' : 's'}</span>
          )}

          {onReport && (
            <button onClick={onReport} className="inline-flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 hover:text-red-500 font-semibold transition-colors">
              <Flag className="w-4 h-4" /> Report
            </button>
          )}
        </div>

        {/* Row 2 — what you can do with it. */}
        <div className="flex flex-wrap items-center gap-3 mt-6">
          {onCopy && (
            <button onClick={onCopy} disabled={copying || adapting} className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand-200 dark:shadow-none disabled:opacity-50">
              {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />} Add to templates
            </button>
          )}
          {onAdapt && (
            <button onClick={onAdapt} disabled={copying || adapting || adaptDisabled} title={adaptTitle} className="inline-flex items-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {adapting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {adaptLabel}
            </button>
          )}
          {/* A text link, not a third button: it is an alternative to taking the template in, not a
              competing primary action. Only rendered for skills — a prompt's variables and an
              assistant's brand config cannot be expressed as a SKILL.md (SQEM-236). */}
          {onDownload && (
            <button
              onClick={onDownload}
              disabled={downloading}
              title={fileNames.length ? `SKILL.md and ${fileNames.length} file${fileNames.length === 1 ? '' : 's'}` : 'SKILL.md — this listing carries no files'}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 underline underline-offset-4 decoration-slate-300 dark:decoration-slate-600 hover:decoration-brand-400 transition-colors disabled:opacity-50 disabled:no-underline"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download as an agent zip folder
            </button>
          )}
        </div>

        {offer}

        {/* What you get — transparency */}
        {(listing.preview?.skillCount || fileNames.length) ? (
          <div className="mt-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft p-5">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">What comes with this copy</h2>
            {fileNames.length > 0 && (
              // SQEM-258 — the list is capped and scrolls: a skill import can bring 151 files, and
              // an uncapped chip list pushes the preview and everything below it off the page. The
              // heading and the skills note stay outside the scroll, so the context does not scroll
              // away with the content. `max-h-96` matches the preview block below rather than
              // inventing a second height next to it.
              <div className="flex flex-wrap gap-1.5 max-h-96 overflow-y-auto">
                {fileNames.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-lg px-2 py-1 text-slate-600 dark:text-slate-300"><FileText className="w-3 h-3" /> {n}</span>
                ))}
              </div>
            )}
            {!!listing.preview?.skillCount && <p className="text-xs text-slate-400 mt-2">Includes {listing.preview.skillCount} embedded skill{listing.preview.skillCount === 1 ? '' : 's'}, resolved into your copy.</p>}
          </div>
        ) : null}

        {/* Body preview */}
        {body && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Preview</h2>
            <pre className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft p-5 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words max-h-96 overflow-y-auto font-sans leading-relaxed">{body}</pre>
          </div>
        )}

        {/* Variables */}
        {listing.variables?.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Variables</h2>
            <div className="flex flex-wrap gap-1.5">
              {(listing.variables as Variable[]).map(v => <span key={v.id} className="text-xs font-mono bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 rounded-lg px-2 py-1">{`{{${v.name}}}`}</span>)}
            </div>
          </div>
        )}

        {/* Footer — soft growth loop */}
        <div className="mt-14 pt-6 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center">
          <a href="https://sqemes.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 hover:text-brand-600 transition-colors">
            <img src={sqemesIcon} alt="" className="w-4 h-4 opacity-70" /> Made with Sqemes <ArrowUpRight className="w-3.5 h-3.5" />
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
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-900 text-center px-6">
      <p className="text-slate-500 dark:text-slate-400">This template isn&apos;t available.</p>
      {/* SQEM-208 — the dead-end state needs the exit most of all: there is nothing else here.
          Except when there is nowhere to send them: a signed-out visitor has no marketplace to go
          back to, and an exit into the sign-in wall is not an exit (SQEM-258). */}
      {onExit && <FullScreenExit label="Back to Marketplace" onExit={onExit} escapeEnabled />}
    </div>
  );
}

export function ListingLoading() {
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
}
