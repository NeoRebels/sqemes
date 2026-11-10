import { Link, useNavigate } from 'react-router';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { useChatSessions } from '../store';
import { m } from '../lib/i18n';
import { relTime } from '../lib/historyItems';
import { splitRunTitle, unseenRoutineChats } from '../lib/routineSchedule';

/**
 * SQEM-677 — "new results from routines" on Start. Shown ONLY while
 * there are unread ones; with none, Start looks exactly as before — no promotion card, no empty slot.
 *
 * Opening a result anywhere (here, History, Routines, another device) marks it read and takes it off
 * this card; the card disappears with the last one. "All routines" marks nothing. The chat title is
 * the routine's name and day (`routineChatTitle`), so no routine query is needed here.
 */
const SHOWN = 3;

const RoutineResultsCard = () => {
  const { chatSessions, markChatsSeen } = useChatSessions();
  const navigate = useNavigate();
  const unseen = unseenRoutineChats(chatSessions);
  if (unseen.length === 0) return null;
  const more = unseen.length - SHOWN;

  return (
    <section aria-labelledby="start-routine-results" className="max-w-3xl mx-auto mb-10 rounded-card border border-line bg-surface-raised p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-2">
        <h2 id="start-routine-results" className="font-semibold text-ink-strong flex items-center gap-2 whitespace-nowrap">
          <CalendarClock className="w-4 h-4 text-accent" /> {m.rt_start_title()}
        </h2>
        <div className="flex items-center gap-4 whitespace-nowrap">
          <button type="button" onClick={() => void markChatsSeen(unseen.map(s => s.id))}
            className="text-sm font-medium text-ink-muted hover:text-ink-strong">
            {m.rt_start_mark_read()}
          </button>
          <Link to="/routines" className="text-sm font-medium text-accent flex items-center gap-1">
            {m.rt_start_all()} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
      <ul className="space-y-0.5">
        {unseen.slice(0, SHOWN).map(s => (
          <li key={s.id} className="group relative flex items-center gap-3 px-2 py-2 -mx-2 rounded-control hover:bg-surface-sunken transition-colors">
            <span aria-hidden className="shrink-0 w-2 h-2 rounded-full bg-accent" />
            <div className="min-w-0 flex-1">
              {/* Name and day apart: truncated as one, the day — the only thing telling two results of one
                  routine apart — was what got cut at 375 px. */}
              <button type="button" onClick={() => navigate(`/chat/${s.id}`)}
                className="flex w-full items-baseline gap-2 text-left text-sm after:absolute after:inset-0 after:content-[''] after:rounded-control">
                <span className="min-w-0 truncate font-medium text-ink">{splitRunTitle(s.title).name}</span>
                {splitRunTitle(s.title).day && <span className="shrink-0 text-xs text-ink-subtle tabular-nums">{splitRunTitle(s.title).day}</span>}
              </button>
            </div>
            <span className="shrink-0 hidden sm:inline text-xs text-ink-subtle tabular-nums">{relTime(new Date(s.lastActiveAt).getTime())}</span>
            <ArrowRight aria-hidden className="shrink-0 w-4 h-4 text-accent" />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link to="/routines" className="inline-block mt-2 text-xs font-medium text-ink-muted hover:text-ink-strong">
          {m.rt_start_more({ count: more })}
        </Link>
      )}
    </section>
  );
};

export default RoutineResultsCard;
