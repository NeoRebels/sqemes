import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { TemplateAccessControl, accessValueToAccess, type TemplateAccessValue } from './TemplateAccessControl';
import { useWorkspace, useUI } from '../store';
import { fetchGroups } from '../lib/api/groups';
import { fetchCanEditMany, type EditorKind } from '../lib/api/editors';
import { setTemplateAccess } from '../lib/api/templateAccess';
import { setPersonaAccess, accessValueToPersonaAccess } from '../lib/api/personaAccess';
import { applyToEditable, bulkSummary, wouldLoseSight } from '../lib/bulkApply';
import { isMultiSeat } from '../lib/templateAccessScope';
import { m } from '../lib/i18n';

/**
 * SQEM-564 / SQEM-646 — access for several playbooks or personas at once. Lifted out of
 * `pages/Templates.tsx` so the Personas page uses the SAME dialog rather than a second copy.
 *
 * It REPLACES each item's access. ⛔ No "Only me": on somebody else's item it would hide it from the
 * admin applying it too (decided in SQEM-564) — and "restricted" with nobody named is stored as
 * that row, so Apply waits for a name. Checked per item with the edit right (`can_edit_*`, failing
 * closed), which is what RLS on the access tables asks; the owner is never written as a row.
 */
export default function BulkAccessModal({
  open, onClose, kind, items, onDone,
}: {
  open: boolean;
  onClose: () => void;
  kind: EditorKind;
  /** The selected items; `createdBy` is each one's owner. */
  items: { id: string; createdBy?: string | null }[];
  /** After writing — e.g. reload the list's access badges. */
  onDone?: () => void;
}) {
  const { workspace, currentUser } = useWorkspace();
  const { showToast } = useUI();
  const [value, setValue] = useState<TemplateAccessValue>({ mode: 'restricted', userIds: [], groupIds: [] });
  const [groups, setGroups] = useState<{ id: string; name: string; memberIds: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const persona = kind === 'persona';

  useEffect(() => {
    if (!open) return;
    setValue({ mode: 'restricted', userIds: [], groupIds: [] });
    if (workspace?.id) fetchGroups(workspace.id).then(setGroups).catch(() => setGroups([]));
  }, [open, workspace?.id]);

  const incomplete = value.mode === 'restricted' && value.userIds.length === 0 && (value.groupIds ?? []).length === 0;
  const loseSight = value.mode === 'restricted' && currentUser
    ? wouldLoseSight(items.map(i => ({ createdBy: i.createdBy ?? null })), currentUser.id, { userIds: value.userIds, groupIds: value.groupIds ?? [] }, groups)
    : 0;

  const apply = async () => {
    if (!workspace?.id || incomplete) return;
    setBusy(true);
    try {
      const owners = new Map(items.map(i => [i.id, i.createdBy ?? null]));
      const outcome = await applyToEditable(
        [...owners.keys()],
        ids => fetchCanEditMany(kind, ids),
        id => persona
          ? setPersonaAccess(id, workspace.id, accessValueToPersonaAccess(value, owners.get(id) ?? null))
          // Each playbook's own owner is stripped from its rows (SQEM-300) — the owner always has access.
          : setTemplateAccess(id, workspace.id, accessValueToAccess(value, owners.get(id) ?? null)),
      );
      onDone?.();
      const { message, type } = bulkSummary(outcome, persona ? 'persona' : 'playbook', m.pb_access_changed());
      showToast(message, type);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} size="md" className="p-6">
      <h3 className="font-display text-xl font-semibold text-ink-strong mb-1">
        {persona ? m.ps_bulk_access_title({ count: items.length }) : m.pb_bulk_access_title({ count: items.length })}
      </h3>
      <p className="text-sm text-ink-muted mb-5">
        {persona ? m.ps_bulk_access_body() : m.pb_bulk_access_body()}
      </p>
      <TemplateAccessControl
        value={value}
        onChange={setValue}
        hint={persona ? m.ps_bulk_access_hint() : m.pb_bulk_access_hint()}
        members={workspace?.members}
        groups={groups}
        multiSeat={isMultiSeat(workspace)}
      />
      {incomplete && (
        <p className="mt-3 text-xs text-ink-muted">{m.pb_pick_someone()}</p>
      )}
      {!incomplete && loseSight > 0 && (
        <p className="mt-3 text-xs text-ink">
          {persona ? m.ps_lose_sight({ count: loseSight }) : m.pb_lose_sight({ count: loseSight })}
        </p>
      )}
      <div className="flex gap-2 mt-6">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{m.pb_cancel()}</Button>
        <Button className="flex-1" onClick={() => void apply()} disabled={incomplete} loading={busy}>
          {busy ? m.pb_applying() : m.pb_apply()}
        </Button>
      </div>
    </Modal>
  );
}
