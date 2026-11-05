import { UserRound } from 'lucide-react';
import Avatar from './ui/Avatar';
import { m } from '../lib/i18n';
import type { OwnerMember } from '../lib/listFilters';

/**
 * SQEM-620 — the owner as one compact line in a preview's Info box (2026-11-03: in the box,
 * not as a third column). The editors keep the full `PersonCard`; a preview is read in passing, so a
 * small avatar and the name are enough. The two unknown states use the editor's words and no avatar —
 * initials made from "None recorded" would dress up an absence as somebody.
 */
export default function OwnerLine({ createdBy, members }: { createdBy?: string | null; members: ReadonlyArray<OwnerMember & { avatar?: string | null }> }) {
  const owner = createdBy ? members.find(mb => mb.id === createdBy) : undefined;
  if (!owner) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-muted">
        <UserRound aria-hidden className="w-4 h-4 text-ink-subtle" />
        {createdBy ? m.ed_owner_gone() : m.ed_owner_none()}
      </span>
    );
  }
  const name = owner.name || owner.email;
  return (
    <span className="inline-flex items-center gap-2 min-w-0" title={owner.name ? owner.email : undefined}>
      <Avatar src={owner.avatar} name={name} className="w-5 h-5" />
      <span className="font-semibold text-ink-strong truncate">{name}</span>
    </span>
  );
}
