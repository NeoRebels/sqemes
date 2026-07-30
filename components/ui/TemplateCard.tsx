import React from 'react';
import { Link } from 'react-router';
import Card from './Card';

// SQEM-106 — shared presentational card shell for template-style cards.
// Used by the Templates page (workspace prompts/assistants/skills) and the
// Marketplace (curated library templates) so both look identical and the card
// chrome lives in one place. Callers fill the slots; this component owns layout.
export default function TemplateCard({
  selected = false,
  topLeft,
  topRight,
  badges,
  title,
  titleHref,
  description,
  footerLeft,
  footerRight,
}: {
  /** Adds the brand ring used for bulk selection. */
  selected?: boolean;
  /** Absolutely-positioned top-left slot (e.g. a bulk-select checkbox). */
  topLeft?: React.ReactNode;
  /** Absolutely-positioned top-right slot (e.g. favorite star or admin controls). */
  topRight?: React.ReactNode;
  /** Badge row (KindBadge, category/draft badges, tag editor…). */
  badges?: React.ReactNode;
  title: string;
  /** When set, the title links here with the shared hover treatment. */
  titleHref?: string;
  description?: string;
  /** Left side of the footer — secondary icon actions or stat chips. */
  footerLeft?: React.ReactNode;
  /** Right side of the footer — the primary action button. */
  footerRight?: React.ReactNode;
}) {
  return (
    <Card hover className={`relative flex flex-col group flex-1 ${selected ? 'ring-2 ring-brand-500' : ''}`}>
      {topLeft}
      {topRight}

      <div className="p-4 flex-1">
        {/* SQEM-164 — badges carry interactive controls (TagEditor) → lift above the stretched title link. */}
        {badges && (
          <div className="relative z-10 flex justify-between items-start mb-3 pr-8">
            <div className="flex gap-2 flex-wrap">{badges}</div>
          </div>
        )}

        {/* SQEM-164 — stretched link: the title's ::after covers the whole (relative) card, so clicking
            anywhere on the card follows the title link, while the title stays a real focusable link and
            the z-10 controls above keep working. */}
        {titleHref ? (
          <Link to={titleHref} className="group-hover:text-brand-600 transition-colors after:absolute after:inset-0 after:content-['']">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2 line-clamp-1">{title}</h3>
          </Link>
        ) : (
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2 line-clamp-1">{title}</h3>
        )}

        {description !== undefined && (
          <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-4 leading-relaxed">{description}</p>
        )}
      </div>

      {(footerLeft || footerRight) && (
        <div className="relative z-10 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex gap-1 items-center">{footerLeft}</div>
          {footerRight}
        </div>
      )}
    </Card>
  );
}
