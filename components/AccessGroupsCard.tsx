// SQEM-292 — access groups, managed by workspace admins.
//
// A group is a named set of people, usable anywhere a person can be named. It exists because a list
// of individuals is *static*: restricting a template to five people does not follow the team. A group
// moves that maintenance to one place.
//
// ⚠️ **Admins only, and the card being hidden is the weaker half of that.** The RLS policies reject
// writes from anyone else, so hiding it here is a courtesy to editors rather than the enforcement.
import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { Input } from './ui/Input';
import Checkbox from './ui/Checkbox';
import { useUI } from '../store';
import type { User } from '../types';
import {
  fetchGroups, createGroup, renameGroup, deleteGroup, setGroupMembers, countTemplatesUsingGroup,
  type WorkspaceGroup,
} from '../lib/api/groups';

export default function AccessGroupsCard({
  workspaceId, members, className = '',
}: { workspaceId: string; members: User[]; className?: string }) {
  const { showToast } = useUI();
  const [groups, setGroups] = useState<WorkspaceGroup[] | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setGroups(await fetchGroups(workspaceId));
    } catch (err: any) {
      showToast(err.message || 'Could not load groups', 'error');
      setGroups([]);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createGroup(workspaceId, name);
      setNewName('');
      await load();
    } catch (err: any) {
      // The unique index on (workspace_id, lower(name)) is the likely cause, and "duplicate key"
      // does not say that to anyone.
      const dup = /duplicate key|unique/i.test(err?.message ?? '');
      showToast(dup ? `A group called “${name}” already exists.` : (err.message || 'Could not create the group'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (g: WorkspaceGroup) => {
    // ⚠️ Deleting a group revokes access everywhere it was used, in one step. `template_access` is
    // ON DELETE CASCADE, so a template restricted only to this group falls back to its creator alone
    // — and nothing at the template says why. Counting first turns "delete Marketing" into the
    // sentence that actually describes the act.
    let used = 0;
    try { used = await countTemplatesUsingGroup(g.id); } catch { /* fall through to the plainer warning */ }
    const warning = used > 0
      ? `Delete “${g.name}”? ${used} template${used === 1 ? '' : 's'} currently grant access through this group — they will lose it.`
      : `Delete “${g.name}”? It is not used by any template.`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    try {
      await deleteGroup(g.id);
      await load();
      showToast(`Deleted “${g.name}”`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not delete the group', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleMember = async (g: WorkspaceGroup, userId: string) => {
    const next = g.memberIds.includes(userId)
      ? g.memberIds.filter(u => u !== userId)
      : [...g.memberIds, userId];
    // Optimistic: the list is the thing being edited, and a round trip per checkbox makes picking
    // six people feel broken.
    setGroups(prev => (prev ?? []).map(x => (x.id === g.id ? { ...x, memberIds: next } : x)));
    try {
      await setGroupMembers(g.id, next);
    } catch (err: any) {
      showToast(err.message || 'Could not save the group', 'error');
      await load();
    }
  };

  const handleRename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await renameGroup(renaming.id, name);
      setRenaming(null);
      await load();
    } catch (err: any) {
      showToast(err.message || 'Could not rename the group', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    /* The Team tab stacks cards with an explicit `mt-*` rather than a `space-y` container, so the
       gap is the caller's to set — see the Invitations card above. */
    <Card className={`p-6 md:p-8 animate-fade-in ${className}`}>
      <div className="flex items-start gap-3 mb-1">
        <Users className="w-5 h-5 text-brand-500 mt-0.5 shrink-0" />
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Access Groups</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Name a set of people once, then grant a template to the group instead of to each person. Adding somebody to a group gives them everything that group can reach.
          </p>
        </div>
      </div>

      <div className="flex gap-2 mt-5 mb-4">
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); } }}
          placeholder="Group name, e.g. Marketing"
          className="flex-1"
        />
        <Button onClick={() => void handleCreate()} loading={creating} disabled={!newName.trim()}>
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>

      {groups === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
          No groups yet. A group keeps working as the team changes — a list of names does not.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map(g => (
            <div key={g.id} className="border border-slate-200 dark:border-slate-700 rounded-xl">
              <div className="flex items-center gap-2 p-3">
                {renaming?.id === g.id ? (
                  <>
                    <Input
                      value={renaming.name}
                      onChange={e => setRenaming({ id: g.id, name: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleRename(); } }}
                      className="flex-1"
                    />
                    <button type="button" onClick={() => void handleRename()} disabled={busy} className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setRenaming(null)} className="p-1.5 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setEditing(editing === g.id ? null : g.id)} className="flex-1 text-left min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{g.name}</span>
                      {/* An empty group grants nobody anything. Saying so here means it is not
                          discovered later, when somebody reports that a template "does not work". */}
                      <span className="block text-xs text-slate-400">
                        {g.memberIds.length === 0 ? 'No members — grants nobody access' : `${g.memberIds.length} ${g.memberIds.length === 1 ? 'person' : 'people'}`}
                      </span>
                    </button>
                    <button type="button" onClick={() => setRenaming({ id: g.id, name: g.name })} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg"><Pencil className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => void handleDelete(g)} disabled={busy} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
              {editing === g.id && (
                <div className="border-t border-slate-100 dark:border-slate-700 p-3 space-y-1 max-h-56 overflow-y-auto">
                  {members.map(m => (
                    <label key={m.id} className="flex items-start gap-2.5 p-1.5 text-sm text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer select-none">
                      <Checkbox checked={g.memberIds.includes(m.id)} onChange={() => void toggleMember(g, m.id)} />
                      <span className="min-w-0">
                        <span className="font-medium">{m.name || m.email}</span>
                        <span className="block text-2xs text-slate-400 truncate">{m.email} · {m.role}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
