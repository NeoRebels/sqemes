import type { ReactNode } from 'react';
import { Link } from 'react-router';
import KindBadge from './ui/KindBadge';
import type { PlaybookRef, PromptKind } from '../types';
import { changeLabel, type LibraryChange } from '../supabase/functions/_shared/libraryChanges.ts';
import type { WebSources } from '../supabase/functions/_shared/webSearch.ts';

/**
 * SQEM-551 — a user message that started from a prompt playbook (redesign C, Figma C5).
 *
 * The card comes IN ADDITION to the text, never instead of it: the text is what
 * the model received, and after "edited" the fields may no longer say the same thing. So the text
 * sits under "Text sent", collapsed. The title links to the playbook only while the viewer can still
 * open it — a deleted or restricted playbook keeps its stored title and loses the link.
 */
export function ChatPlaybookCard({
  playbookRef, content, linkable, children,
}: {
  playbookRef: PlaybookRef;
  content: string;
  linkable: boolean;
  /** Attachments of the message, shown inside "Text sent" with the text they belong to. */
  children?: ReactNode;
}) {
  const title = <span className="font-display text-base font-semibold text-ink-strong leading-snug">{playbookRef.title}</span>;
  return (
    <div className="w-full max-w-md rounded-card border border-line bg-surface-raised shadow-rest px-4 py-3 text-left">
      <div className="flex items-start gap-2 flex-wrap">
        <KindBadge kind={playbookRef.kind} />
        {linkable
          ? <Link to={`/playbooks?id=${encodeURIComponent(playbookRef.id)}`} className="hover:underline">{title}</Link>
          : title}
      </div>
      {playbookRef.fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {playbookRef.fields.map((f, i) => (
            <div key={i} className="contents">
              <dt className="text-ink-muted">{f.name}</dt>
              <dd className="text-ink break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {playbookRef.edited && <p className="mt-2 text-xs text-ink-subtle">Edited before sending</p>}
      <details className="mt-2 group">
        <summary className="cursor-pointer text-xs font-medium text-accent select-none">Text sent</summary>
        {children}
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink">{content}</p>
      </details>
    </div>
  );
}

/**
 * SQEM-551 — under an answer: the playbooks the model loaded for exactly this answer. Only those the
 * viewer can see are passed in (`usedPlaybooks` in lib/playbookRef.ts); nothing renders when none are.
 */
export function UsedPlaybookChips({ used }: { used: { id: string; title: string; kind: PromptKind }[] }) {
  if (used.length === 0) return null;
  return (
    <div className="mt-2 ml-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-ink-subtle">Used</span>
      {used.map(p => (
        <Link
          key={p.id}
          to={`/playbooks?id=${encodeURIComponent(p.id)}`}
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.kind === 'skill' ? 'text-skill bg-skill-soft' : 'text-accent bg-accent-soft'} hover:underline`}
        >
          {p.title}
        </Link>
      ))}
    </div>
  );
}

/**
 * SQEM-561 — under an answer: what the model created, changed or deleted in the library for it. Each
 * line links to the object while the viewer can open it; the wording per line comes from
 * `changeLabel` (supabase/functions/_shared/libraryChanges.ts), so a shared chat never names an
 * object the viewer cannot see.
 */
const CHANGE_VERB: Record<LibraryChange['action'], string> = { created: 'Created', updated: 'Updated', deleted: 'Deleted' };
const CHANGE_NOUN: Record<LibraryChange['kind'], string> = { prompt: 'prompt', skill: 'skill', persona: 'persona', file: 'file' };

function changeHref(c: LibraryChange): string {
  if (c.kind === 'persona') return `/personas?id=${encodeURIComponent(c.id)}`;
  if (c.kind === 'file') return '/files';
  return `/playbooks?id=${encodeURIComponent(c.id)}`;
}

export function LibraryChangesCard({
  changes, currentTitle,
}: {
  changes: LibraryChange[] | undefined;
  /** The viewer's own current title for an object, or undefined when they cannot see it. */
  currentTitle: (c: LibraryChange) => string | undefined;
}) {
  if (!changes?.length) return null;
  return (
    <div className="mt-2 ml-1 w-full max-w-md rounded-card border border-line bg-surface-raised shadow-rest px-4 py-3 text-left">
      <p className="text-xs font-medium text-ink-subtle">Changed in your library</p>
      <ul className="mt-1.5 space-y-1">
        {changes.map(c => {
          const { title, linked } = changeLabel(c, currentTitle(c));
          return (
            <li key={`${c.kind}:${c.id}`} className="flex items-baseline gap-2 text-sm">
              <span className={`shrink-0 text-xs font-medium ${c.action === 'deleted' ? 'text-danger' : 'text-ink-muted'}`}>
                {CHANGE_VERB[c.action]} {CHANGE_NOUN[c.kind]}
              </span>
              {linked
                ? <Link to={changeHref(c)} className="text-ink hover:underline break-words">{title}</Link>
                : <span className={`break-words ${c.action === 'deleted' ? 'text-ink-muted line-through' : 'text-ink-muted'}`}>{title}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * SQEM-594 — under an answer that used web search: what it searched for and which pages it read.
 * Queries and URLs only — the page content itself is never stored (see `_shared/webSearch.ts`).
 * External links open in a new tab without a referrer.
 */
export function WebSourcesCard({ sources }: { sources: WebSources | null | undefined }) {
  if (!sources || (!sources.queries.length && !sources.pages.length)) return null;
  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
  return (
    <div className="mt-2 ml-1 w-full max-w-md rounded-card border border-line bg-surface-raised shadow-rest px-4 py-3 text-left">
      <p className="text-xs font-medium text-ink-subtle">Searched the web</p>
      {sources.queries.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {sources.queries.map((q, i) => <li key={i} className="text-sm text-ink-muted break-words">“{q}”</li>)}
        </ul>
      )}
      {sources.pages.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium text-ink-subtle">Pages read</p>
          <ul className="mt-1 space-y-0.5">
            {sources.pages.map(p => (
              <li key={p.url} className="text-sm break-words">
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-ink hover:underline">
                  {p.title || host(p.url)}
                </a>
                <span className="ml-1.5 text-xs text-ink-subtle">{host(p.url)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
