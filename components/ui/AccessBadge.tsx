import React from 'react';
import { Lock } from 'lucide-react';
import { ACCESS_BADGE_LABEL, ACCESS_BADGE_TITLE, type AccessBadgeMode } from '../../lib/accessBadge';

/**
 * SQEM-400 — the badge on a playbook or persona card that carries an access rule.
 *
 * One component for both card pages, because SQEM-330 wrote the same pill twice "in the same words"
 * and a second vocabulary for one state is how two screens begin disagreeing about what "restricted"
 * means. The word and the tooltip come from `lib/accessBadge.ts`: "Only me" for the principal-less
 * row, "Restricted" for rules naming people or groups. Renders nothing without a mode — an open
 * playbook has no badge.
 */
export default function AccessBadge({ mode }: { mode?: AccessBadgeMode }) {
  if (!mode) return null;
  return (
    <span
      className="text-2xs font-bold px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-lg uppercase tracking-wider flex items-center gap-1 shrink-0"
      title={ACCESS_BADGE_TITLE[mode]}
    >
      <Lock className="w-3 h-3" /> {ACCESS_BADGE_LABEL[mode]}
    </span>
  );
}
