import React, { useEffect, useState } from 'react';
import Card from './ui/Card';
import SettingsCardHeader from './ui/SettingsCardHeader';
import Switch from './ui/Switch';
import CardSaveBar from './ui/CardSaveBar';
import { m } from '../lib/i18n';
import { moderatorCandidates } from '../lib/moderation';
import { fetchModeratorIds, setModerators } from '../lib/api/moderation';
import { setCachedModerators } from '../hooks/useModeration';
import type { Workspace } from '../types';

/**
 * SQEM-666 — Settings → Security → Moderation (admins, hosted, several seats).
 *
 * One switch for NEW playbooks and personas, and the moderators: editors only in the list — admins
 * always moderate, so they are named, not ticked. The database enforces all of it (guard_moderation_new,
 * guard_workspace_moderator, drop_demoted_moderator); this card is only where it is chosen.
 * SQEM-667 — the second switch: changes to shared ones wait for review. It works only together with the
 * first (otherwise a new, at once shared playbook would be the way round it), so it is disabled while the
 * first is off, and the database turns it off with the first.
 */
export default function ModerationCard({
  workspace, onSave, onDirtyChange,
}: {
  workspace: Workspace;
  onSave: (updates: Partial<Workspace>) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [savedIds, setSavedIds] = useState<string[] | null>(null);
  const [onDraft, setOnDraft] = useState<boolean | null>(null);
  const [changesDraft, setChangesDraft] = useState<boolean | null>(null);
  const [idsDraft, setIdsDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchModeratorIds(workspace.id).then(ids => { if (alive) setSavedIds(ids); });
    return () => { alive = false; };
  }, [workspace.id]);

  const dirty = onDraft !== null || changesDraft !== null || idsDraft !== null;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const enabled = onDraft ?? workspace.moderationNew ?? false;
  const changesOn = enabled && (changesDraft ?? workspace.moderationChanges ?? false);
  const setChanges = (next: boolean) => setChangesDraft(next === (workspace.moderationChanges ?? false) ? null : next);
  const editors = moderatorCandidates(workspace.members ?? []).filter(u => u.role === 'editor');
  const admins = (workspace.members ?? []).filter(u => u.role === 'admin');
  // A saved moderator who has meanwhile become a member is gone from the table already; only editors show.
  const chosen = new Set(idsDraft ?? savedIds ?? []);

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    const list = [...next].sort();
    setIdsDraft(sameIds(list, savedIds ?? []) ? null : list);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (onDraft !== null || changesDraft !== null) {
        await onSave({ moderationNew: enabled, moderationChanges: changesOn });
      }
      if (idsDraft !== null) {
        await setModerators(workspace.id, idsDraft);
        setSavedIds(idsDraft);
        setCachedModerators(workspace.id, idsDraft);
      }
      setOnDraft(null);
      setChangesDraft(null);
      setIdsDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 md:p-8">
      <SettingsCardHeader title={m.mod_title()} description={m.mod_desc()} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="mod-new-label" className="text-sm font-semibold text-ink-strong">{m.mod_new_label()}</p>
          <p className="text-xs text-ink-muted mt-0.5">{m.mod_new_desc()}</p>
        </div>
        <Switch
          checked={enabled}
          onChange={next => {
            setOnDraft(next === (workspace.moderationNew ?? false) ? null : next);
            if (!next) setChanges(false); // the second switch goes with the first
          }}
          labelledBy="mod-new-label"
        />
      </div>
      <div className={`flex items-start justify-between gap-4 mt-4 ${enabled ? '' : 'opacity-50'}`}>
        <div className="min-w-0">
          <p id="mod-changes-label" className="text-sm font-semibold text-ink-strong">{m.mod_changes_label()}</p>
          <p className="text-xs text-ink-muted mt-0.5">{enabled ? m.mod_changes_desc() : m.mod_changes_needs_new()}</p>
        </div>
        <Switch checked={changesOn} onChange={setChanges} labelledBy="mod-changes-label" disabled={!enabled} />
      </div>

      <div className="mt-6">
        <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-1">{m.mod_moderators()}</p>
        <p className="text-xs text-ink-subtle mb-3">
          {admins.length ? m.mod_admins_always({ names: admins.map(a => a.name || a.email).join(', ') }) : m.mod_admins_always_none()}
        </p>
        {editors.length === 0 ? (
          <p className="text-sm text-ink-muted">{m.mod_no_editors()}</p>
        ) : (
          <ul className="space-y-1">
            {editors.map(u => (
              <li key={u.id}>
                <label className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0" checked={chosen.has(u.id)} onChange={() => toggle(u.id)} disabled={savedIds === null} />
                  <span className="text-sm text-ink">{u.name || u.email}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-subtle mt-3">{m.mod_members_never()}</p>
      </div>

      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      <CardSaveBar dirty={dirty} saving={saving} onCancel={() => { setOnDraft(null); setChangesDraft(null); setIdsDraft(null); }} onSave={() => void save()} />
    </Card>
  );
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every(x => s.has(x));
}
