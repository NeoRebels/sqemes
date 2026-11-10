import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarClock, Loader2, Pencil, Plus, Trash2, AlertTriangle, MessageSquare } from 'lucide-react';
import { useChatSessions, useUI, useWorkspace } from '../store';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Switch from '../components/ui/Switch';
import ConfirmModal from '../components/ui/ConfirmModal';
import { m } from '../lib/i18n';
import { deleteRoutine, fetchRoutines, setRoutinePaused, RoutineSaveError } from '../lib/api/routines';
import { ACTIVE_LIMIT, describeSchedule, routineStateLine, unseenByRoutine } from '../lib/routineSchedule';
import type { Routine } from '../types';

/**
 * SQEM-677 — a person's own routines (SQEM-672). One list, like History: a routine is a scheduled
 * chat, and its results ARE chats — there is deliberately no run log here.
 * (Guardrail: pm/VISION.md in the source repository.) The row links to the newest result; History holds the rest.
 */
const Routines = () => {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { showToast } = useUI();
  const { chatSessions, refreshChatSessions } = useChatSessions();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Routine | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRoutines(workspace.id)
      .then(r => { if (!cancelled) setRoutines(r); })
      .catch(() => { if (!cancelled) { setRoutines([]); showToast(m.rt_load_failed(), 'error'); } });
    void refreshChatSessions(); // a result may have arrived since the list was loaded
    return () => { cancelled = true; };
  }, [workspace.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unseen = useMemo(() => unseenByRoutine(chatSessions), [chatSessions]);
  const active = routines?.filter(r => r.pausedReason === null).length ?? 0;

  const toggle = async (r: Routine) => {
    setBusyId(r.id);
    try {
      const next = await setRoutinePaused(r.id, r.pausedReason === null);
      setRoutines(prev => prev?.map(x => x.id === r.id ? next : x) ?? prev);
    } catch (err) {
      showToast(err instanceof RoutineSaveError && err.kind === 'limit' ? m.rt_err_limit({ limit: ACTIVE_LIMIT }) : m.rt_save_failed(), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteRoutine(toDelete.id);
      setRoutines(prev => prev?.filter(x => x.id !== toDelete.id) ?? prev);
      showToast(m.rt_deleted(), 'success');
      setToDelete(null);
    } catch {
      showToast(m.rt_delete_failed(), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const row = (r: Routine) => {
    const state = routineStateLine(r);
    const count = unseen.get(r.id) ?? 0;
    const on = r.pausedReason === null;
    return (
      // As in History: the name is the button and its ::after covers the row; the controls sit above it.
      <li key={r.id} className="group relative flex items-center gap-3 px-3 py-3 rounded-control hover:bg-surface-sunken transition-colors">
        <div className={`shrink-0 w-9 h-9 rounded-chip border border-line flex items-center justify-center ${on ? 'bg-accent-soft text-accent' : 'bg-surface-sunken text-ink-subtle'}`}>
          <CalendarClock className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          {/* line-clamp + hyphens: at 375 px a long German name split mid-word over a dozen lines. */}
          <button
            type="button"
            onClick={() => navigate(`/routines/${r.id}/edit`)}
            className="block w-full text-left text-sm font-semibold text-ink-strong line-clamp-2 hyphens-auto after:absolute after:inset-0 after:content-[''] after:rounded-control"
          >
            {r.name}
          </button>
          <p className="text-xs text-ink-muted">{describeSchedule(r.days, r.timeOfDay)}</p>
          <p className={`text-xs mt-0.5 flex items-start gap-1 ${state.warn ? 'text-warning' : 'text-ink-subtle'}`}>
            {state.warn && <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
            {state.text}
          </p>
        </div>
        {r.lastSessionId && (
          // On a phone the label gives way to an icon; the link itself must stay — it is the way to the result.
          // The name comes from the text (sr-only on phones), so the unread count is read with it.
          <Link
            to={`/chat/${r.lastSessionId}`}
            title={m.rt_last_result()}
            className="hit-24 relative z-10 shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline whitespace-nowrap"
          >
            <MessageSquare aria-hidden className="w-4 h-4 sm:hidden" />
            <span className="sr-only sm:not-sr-only">{m.rt_last_result()}</span>
            {count > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent-strong text-white text-2xs font-bold tabular-nums flex items-center justify-center">
                <span aria-hidden>{count}</span><span className="sr-only">{m.nav_unread({ count })}</span>
              </span>
            )}
          </Link>
        )}
        <div className="relative z-10 shrink-0 flex items-center">
          <Switch
            checked={on}
            disabled={busyId === r.id}
            onChange={() => toggle(r)}
            size="sm"
            ariaLabel={on ? m.rt_pause_x({ name: r.name }) : m.rt_resume_x({ name: r.name })}
          />
        </div>
        <button
          type="button"
          onClick={() => navigate(`/routines/${r.id}/edit`)}
          title={m.rt_edit()}
          aria-label={m.rt_edit_x({ name: r.name })}
          className="relative z-10 shrink-0 w-7 h-7 rounded-chip hidden sm:flex items-center justify-center text-ink-subtle reveal-on-hover hover:text-accent transition-colors"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setToDelete(r)}
          title={m.rt_delete()}
          aria-label={m.rt_delete_x({ name: r.name })}
          // On a phone the row is text, last result and switch; delete lives in the editor there.
          className="relative z-10 shrink-0 w-7 h-7 rounded-chip hidden sm:flex items-center justify-center text-ink-subtle reveal-on-hover hover:text-danger hover:bg-danger-soft transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </li>
    );
  };

  return (
    // The reading width of History: one column of names and times.
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-3xl mx-auto">
      <PageHeader
        title={m.nav_routines()}
        subtitle={m.rt_subtitle()}
        actions={routines && routines.length > 0 && (
          <Button onClick={() => navigate('/routines/new')}><Plus className="w-4 h-4" /> {m.rt_new()}</Button>
        )}
      />
      {routines === null ? (
        <div className="flex items-center gap-2 text-ink-subtle text-sm py-20 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> {m.rt_loading()}
        </div>
      ) : routines.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="w-8 h-8" />}
          tone="brand"
          title={m.rt_empty_title()}
          description={m.rt_empty_desc()}
          action={<Button onClick={() => navigate('/routines/new')}><Plus className="w-4 h-4" /> {m.rt_new()}</Button>}
        />
      ) : (
        <section aria-label={m.nav_routines()}>
          <h2 className="px-1 pb-2 text-xs font-semibold text-ink-subtle uppercase tracking-wider">
            {m.rt_active_count({ active, limit: ACTIVE_LIMIT })}
          </h2>
          <ul className="rounded-card border border-line bg-surface-raised p-2 space-y-0.5">{routines.map(row)}</ul>
          <p className="px-1 pt-3 text-xs text-ink-subtle">
            {m.rt_results_in_history_1()} <Link to="/history" className="font-semibold text-accent hover:underline">{m.nav_history()}</Link>{m.rt_results_in_history_2()}
          </p>
        </section>
      )}
      <ConfirmModal
        open={!!toDelete}
        title={m.rt_delete_title()}
        confirmLabel={m.rt_delete()}
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => !deleting && setToDelete(null)}
      >
        {toDelete && <p><span className="font-medium">{toDelete.name}</span> — {m.rt_delete_body()}</p>}
      </ConfirmModal>
    </div>
  );
};

export default Routines;
