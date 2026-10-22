import type { ReactNode } from 'react';
import { Link } from 'react-router';
import KindBadge from './ui/KindBadge';
import type { PlaybookRef, PromptKind } from '../types';

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
