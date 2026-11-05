import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { TemplateAccessControl, type TemplateAccessValue } from './TemplateAccessControl';
import { useWorkspace, useUI } from '../store';
import { fetchGroups } from '../lib/api/groups';
import { fetchCanManageEditorsMany, setEditors, type EditorKind } from '../lib/api/editors';
import { applyToEditable, bulkSummary, COUNT_NOUN } from '../lib/bulkApply';
import { editorsForItem } from '../lib/bulkEditors';
import { isMultiSeat } from '../lib/templateAccessScope';
import { m } from '../lib/i18n';

/**
 * SQEM-621 — "Who can edit" for several playbooks or personas at once, with the same choice as the
 * editor (SQEM-473): anyone who may edit, or only selected people and groups (nobody selected = each
 * item's own owner, plus admins). It REPLACES each item's list.
 *
 * ⛔ Only the owner or an admin may set a list (`can_manage_*_editors`, enforced by RLS), so the check
 * is that one, not "may edit": an editor who selected colleagues' items gets those skipped and is told
 * so, rather than a write that RLS would refuse one by one.
 */
export default function BulkEditorsModal({
  open, onClose, kind, items, onDone,
}: {
  open: boolean;
  onClose: () => void;
  kind: EditorKind;
  /** The selected items; `createdBy` is each one's owner. */
  items: { id: string; createdBy?: string | null }[];
  onDone?: () => void;
}) {
  const { workspace, currentUser } = useWorkspace();
  const { showToast } = useUI();
  const [value, setValue] = useState<TemplateAccessValue>({ mode: 'everyone', userIds: [], groupIds: [] });
  const [groups, setGroups] = useState<{ id: string; name: string; memberIds: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const noun = kind === 'template' ? 'playbook' : 'persona';

  useEffect(() => {
    if (!open) return;
    setValue({ mode: 'everyone', userIds: [], groupIds: [] });
    if (workspace?.id) fetchGroups(workspace.id).then(setGroups).catch(() => setGroups([]));
  }, [open, workspace?.id]);

  const apply = async () => {
    if (!workspace?.id) return;
    setBusy(true);
    try {
      const owners = new Map(items.map(i => [i.id, i.createdBy ?? null]));
      const outcome = await applyToEditable(
        [...owners.keys()],
        ids => fetchCanManageEditorsMany(kind, ids),
        id => setEditors(kind, id, workspace.id, editorsForItem(value, owners.get(id) ?? null, currentUser.id)),
      );
      const { message, type } = bulkSummary(outcome, noun, m.bulk_editors_changed());
      showToast(message, type);
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} size="md" className="p-6">
      <h3 className="font-display text-xl font-semibold text-ink-strong mb-1">
        {m.bulk_editors_title({ things: COUNT_NOUN[noun]({ count: items.length }) })}
      </h3>
      <p className="text-sm text-ink-muted mb-5">{m.bulk_editors_body()}</p>
      <TemplateAccessControl
        variant="edit"
        label={m.ed_who_can_edit()}
        // The control's default hint is the ACCESS one ("who can see and use this playbook") — wrong here.
        hint={kind === 'template' ? m.bulk_editors_hint_playbook() : m.bulk_editors_hint_persona()}
        value={value}
        onChange={setValue}
        members={workspace?.members}
        groups={groups}
        multiSeat={isMultiSeat(workspace)}
      />
      {value.mode === 'restricted' && value.userIds.length === 0 && (value.groupIds ?? []).length === 0 && (
        <p className="mt-3 text-xs text-ink-muted">{m.bulk_editors_owner_only()}</p>
      )}
      <div className="flex gap-2 mt-6">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{m.pb_cancel()}</Button>
        <Button className="flex-1" onClick={() => void apply()} loading={busy}>
          {busy ? m.pb_applying() : m.pb_apply()}
        </Button>
      </div>
    </Modal>
  );
}
