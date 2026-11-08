import React from 'react';
import { Lock, UserLock, UserPen, type LucideIcon } from 'lucide-react';
import { ACCESS_BADGE_TITLE, type AccessBadgeMode } from '../../lib/accessBadge';
import { m } from '../../lib/i18n';

/**
 * SQEM-664 — who may see and who may change a playbook or persona, as icons in a list row.
 *
 * The row used to carry the word ("Only me", "Restricted") and said nothing about editing. Words in
 * every row compete with the title; two states as two words would double that. So the row shows
 * icons and the preview spells them out (`AccessBadge`, `EditBadge`).
 *
 * ⛔ **One glyph per state, everywhere it appears**: the row, the preview
 * badge, the editor's Access and "Who can edit" options and the read-only banner all take their icon
 * from `ACCESS_ICON` / `EDIT_ICON`, so a person who has seen the icon in the editor recognises it in the
 * list. The first build drew "only me" as a lock with a hand-made "1" pill and the editor as
 * `UserRound`, and "Who can edit" as a lock in the editor but `UserPen` in the row: three vocabularies
 * for two rights. `UserLock` is lucide's own glyph, in the same stroke as the rest of the icon set.
 *
 * ⛔ Meaning is never carried by colour alone. Both neutral (`ink-subtle`): accent is for actions and
 * selection (Impeccable, Operate mode). Each icon has a tooltip and an accessible name.
 */
export const ACCESS_ICON: Record<AccessBadgeMode, LucideIcon> = { private: UserLock, restricted: Lock };
export const EDIT_ICON: LucideIcon = UserPen;

export default function RightsIcons({ access, editRestricted }: { access?: AccessBadgeMode; editRestricted?: boolean }) {
  if (!access && !editRestricted) return null;
  const AccessIcon = access ? ACCESS_ICON[access] : null;
  return (
    <span className="relative z-10 flex items-center gap-1.5 shrink-0 text-ink-subtle">
      {access && AccessIcon && (
        <span role="img" aria-label={ACCESS_BADGE_TITLE[access]} title={ACCESS_BADGE_TITLE[access]} className="inline-flex">
          <AccessIcon aria-hidden className="w-3.5 h-3.5" />
        </span>
      )}
      {editRestricted && (
        <span role="img" aria-label={m.edit_badge_restricted_title()} title={m.edit_badge_restricted_title()} className="inline-flex">
          <EDIT_ICON aria-hidden className="w-3.5 h-3.5" />
        </span>
      )}
    </span>
  );
}

/**
 * The preview's spelled-out form of the edit restriction, beside `AccessBadge` and in its style. The
 * word names only who ("Selected people"); the pen says it is about editing: the icon is what tells it
 * apart from Access, and an "Editing:" prefix only repeated it.
 */
export function EditBadge({ restricted }: { restricted?: boolean }) {
  if (!restricted) return null;
  return (
    <span
      className="text-2xs font-bold px-2.5 py-1 bg-surface-sunken text-slate-500 dark:text-slate-300 rounded-lg uppercase tracking-wider flex items-center gap-1 shrink-0"
      title={m.edit_badge_restricted_title()}
    >
      <EDIT_ICON className="w-3 h-3" /> {m.edit_badge_restricted()}
    </span>
  );
}
