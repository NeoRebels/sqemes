import React, { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw, Trash2, Loader2, FileX } from 'lucide-react';
import ConfirmModal from './ui/ConfirmModal';
import Button from './ui/Button';
import { fetchVersions, fetchVersionStates, fetchPresentFiles, restoreVersion, deleteVersion, type TemplateVersion, type TemplateVersionSummary } from '../lib/api/versions';
import { lineDiff, diffCounts, withContext } from '../lib/lineDiff';
import { errorMessage } from '../lib/errorMessage';
import type { User } from '../types';

/**
 * SQEM-477 — the "History" tab of the playbook editor: every saved state, a diff against the one before
 * it, and restore / delete. The database records the versions and decides who may restore or delete
 * (the edit right); this panel only hides the buttons from people who would be refused.
 */
interface Props {
  templateId: string;
  canEdit: boolean;
  members: User[];
  /** Bumped by the editor after a save, so a new version appears without a reload. */
  refreshKey: number;
  /** The editor has unsaved changes a restore would discard. */
  isDirty: boolean;
  onRestored: (result: { version: number | null; missingFiles: string[] }) => void;
  onError: (message: string) => void;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function VersionHistoryPanel({ templateId, canEdit, members, refreshKey, isDirty, onRestored, onError }: Props) {
  const [versions, setVersions] = useState<TemplateVersionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, TemplateVersion>>({});
  const [busy, setBusy] = useState(false);
  const [present, setPresent] = useState<Record<string, Set<string>>>({});
  const [confirm, setConfirm] = useState<null | { kind: 'restore' | 'delete'; version: TemplateVersionSummary }>(null);

  const author = (id: string | null) => {
    if (!id) return 'Unknown';
    return members.find(m => m.id === id)?.name || 'Former member';
  };

  useEffect(() => {
    let live = true;
    fetchVersions(templateId).then(v => {
      if (!live) return;
      setVersions(v);
      setSelectedId(prev => (prev && v.some(x => x.id === prev) ? prev : v[0]?.id ?? null));
    }).catch(e => { if (live) { setVersions([]); onError(errorMessage(e, 'Something went wrong — try again.')); } });
    return () => { live = false; };
  }, [templateId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The selected version and the one before it that still exists (an older one may have been deleted).
  const selected = versions?.find(v => v.id === selectedId) ?? null;
  const previous = useMemo(() => {
    if (!versions || !selected) return null;
    return versions.find(v => v.version < selected.version) ?? null;
  }, [versions, selected]);

  useEffect(() => {
    const need = [selected?.id, previous?.id].filter((x): x is string => !!x && !states[x]);
    if (need.length === 0) return;
    let live = true;
    fetchVersionStates(need).then(rows => {
      if (live) setStates(prev => Object.fromEntries([...Object.entries(prev), ...rows.map(r => [r.id, r])]));
    }).catch(e => { if (live) onError(errorMessage(e, 'Something went wrong — try again.')); });
    return () => { live = false; };
  }, [selected?.id, previous?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which of the selected version's files still exist, so a deleted one can be named as such.
  useEffect(() => {
    if (!selected || present[selected.id]) return;
    let live = true;
    fetchPresentFiles(selected.id).then(ids => { if (live) setPresent(prev => ({ ...prev, [selected.id]: ids })); }).catch(() => {});
    return () => { live = false; };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = versions?.[0] ?? null;
  const now = selected ? states[selected.id] : undefined;
  const before = previous ? states[previous.id] : undefined;

  const contentDiff = useMemo(() => {
    if (!now) return null;
    return lineDiff(before?.content ?? '', now.content);
  }, [now, before]);

  const fieldChanges = useMemo(() => {
    if (!now || !before) return [];
    const out: string[] = [];
    if (now.title !== before.title) out.push(`Title: “${before.title}” → “${now.title}”`);
    if (now.description !== before.description) out.push('Description changed');
    if ((now.tag ?? '') !== (before.tag ?? '')) out.push(`Tag: ${before.tag || 'none'} → ${now.tag || 'none'}`);
    const names = (fs: TemplateVersion['contextFiles']) => fs.map(f => f.name || f.id);
    const was = names(before.contextFiles), is = names(now.contextFiles);
    const added = is.filter(n => !was.includes(n)), removed = was.filter(n => !is.includes(n));
    if (added.length) out.push(`Files attached: ${added.join(', ')}`);
    if (removed.length) out.push(`Files detached: ${removed.join(', ')}`);
    return out;
  }, [now, before]);

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'restore') {
        const result = await restoreVersion(confirm.version.id);
        onRestored(result);
      } else {
        await deleteVersion(confirm.version.id);
        setVersions(v => (v ?? []).filter(x => x.id !== confirm.version.id));
        if (selectedId === confirm.version.id) setSelectedId(latest?.id ?? null);
      }
    } catch (e) {
      onError(errorMessage(e, 'Something went wrong — try again.'));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  // SQEM-581 — design-system tokens throughout (was slate/brand/emerald/red/amber), lists and states as
  // in redesign C, confirmations through ConfirmModal so the title has the display face.
  if (versions === null) {
    return <div className="flex-1 flex items-center justify-center text-ink-subtle"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (versions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-muted">
        <History className="w-6 h-6 text-ink-subtle" />
        No versions yet. Every save keeps one.
      </div>
    );
  }

  const counts = contentDiff ? diffCounts(contentDiff) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Version list */}
      <ul className="max-h-[40%] overflow-y-auto border-b border-line p-2 space-y-0.5 shrink-0">
        {versions.map(v => (
          <li key={v.id}>
            <button
              onClick={() => setSelectedId(v.id)}
              aria-current={v.id === selectedId ? 'true' : undefined}
              className={`w-full text-left px-3 py-2 rounded-control text-sm transition-colors ${v.id === selectedId ? 'bg-accent-soft' : 'hover:bg-surface-sunken'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink-strong">
                  Version {v.version}{v.id === latest?.id && <span className="ml-2 text-xs font-medium text-accent">current</span>}
                </span>
                <span className="text-xs text-ink-subtle shrink-0">{when(v.createdAt)}</span>
              </div>
              <div className="text-xs text-ink-muted truncate">
                {author(v.createdBy)}{v.note && <> · {v.note}</>}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* The selected version against the one before it */}
      {selected && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-line shrink-0">
            <span className="text-xs text-ink-muted">
              {previous ? `Changes since version ${previous.version}` : 'First version'}
              {counts && previous && <> · <span className="text-success">+{counts.added}</span> <span className="text-danger">−{counts.removed}</span></>}
            </span>
            {canEdit && selected.id !== latest?.id && (
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'restore', version: selected })}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />Restore
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'delete', version: selected })} aria-label={`Delete version ${selected.version}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {!now ? (
              <div className="p-6 flex justify-center text-ink-subtle"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : (
              <>
                {fieldChanges.length > 0 && (
                  <ul className="px-4 py-2 text-xs text-ink space-y-0.5 border-b border-line">
                    {fieldChanges.map(c => <li key={c}>{c}</li>)}
                  </ul>
                )}
                {now.contextFiles.length > 0 && (
                  <p className="px-4 py-2 text-xs text-ink-muted border-b border-line">
                    Files:{' '}
                    {now.contextFiles.map((f, k) => {
                      const gone = present[now.id] ? !present[now.id].has(f.id) : false;
                      return (
                        <span key={f.id} className={gone ? 'text-warning' : ''}>
                          {k > 0 && ', '}{gone && <FileX className="inline w-3 h-3 mr-0.5 -mt-0.5" />}{f.name || 'Unnamed file'}{gone && ' (deleted)'}
                        </span>
                      );
                    })}
                  </p>
                )}
                <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                  {withContext(contentDiff ?? [], previous ? 3 : Number.MAX_SAFE_INTEGER).map((row, k) => row.type === 'gap' ? (
                    <div key={k} className="px-4 py-1 text-ink-subtle bg-surface-sunken select-none">⋯ {row.count} unchanged line{row.count === 1 ? '' : 's'}</div>
                  ) : (
                    <div key={k} className={`px-4 ${row.type === 'added' && previous ? 'bg-success-soft text-ink-strong' : row.type === 'removed' ? 'bg-danger-soft text-ink-strong line-through decoration-danger/40' : 'text-ink'}`}>
                      <span className="select-none text-ink-subtle mr-2">{row.type === 'added' && previous ? '+' : row.type === 'removed' ? '−' : ' '}</span>
                      {/* SQEM-544 — a blank line that was added or removed is named, not shown as a bare sign. */}
                      {row.text || ((row.type === 'removed' || (row.type === 'added' && previous)) ? <span className="select-none italic text-ink-subtle no-underline">(empty line)</span> : ' ')}
                    </div>
                  ))}
                </pre>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        title={confirm ? `${confirm.kind === 'restore' ? 'Restore' : 'Delete'} version ${confirm.version.version}?` : ''}
        confirmLabel={confirm?.kind === 'delete' ? 'Delete' : 'Restore'}
        variant={confirm?.kind === 'delete' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={run}
        onClose={() => !busy && setConfirm(null)}
      >
        {confirm?.kind === 'restore' ? (
          <>
            <p>Its title, description, content and files become the current playbook, saved as a new version. Nothing is lost — the current state stays in the history. Files deleted since cannot come back and are left out.</p>
            {isDirty && <p className="text-warning">Your unsaved changes in the editor will be discarded.</p>}
          </>
        ) : (
          <p>It disappears from the history for everyone and cannot be restored afterwards.</p>
        )}
      </ConfirmModal>
    </div>
  );
}
