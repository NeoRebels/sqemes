import Avatar from './Avatar';
import type { UserRole } from '../../types';

/**
 * SQEM-241 — one way to show a person, used everywhere a person is shown.
 *
 * This markup lived inline in `Sidebar.tsx` as the "My Profile" row. When the template editor needed
 * to show a template's owner (SQEM-241), copying it would have meant two nearly-identical blocks
 * drifting apart on the next avatar or badge change — the same shape of problem as the two access
 * functions that must be edited in lockstep. Extracted instead, so there is one element to maintain.
 *
 * Deliberately dumb: no navigation, no store access, no data fetching. Callers decide what a click
 * does — and a card with no `onClick` renders as a plain panel rather than pretending to be a button.
 */
export function PersonCard({
  name,
  subtitle,
  avatar,
  role,
  collapsed = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className = '',
}: {
  name: string;
  /** Second line — an email, a hint, whatever identifies this person here. */
  subtitle?: string;
  avatar?: string | null;
  /** Shown as a badge beside the name. Omit where the role is irrelevant or unknown. */
  role?: UserRole | string;
  /** Avatar only — the collapsed sidebar. */
  collapsed?: boolean;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
  className?: string;
}) {
  const interactive = !!onClick;

  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`flex items-center ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-3'} rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 ${
        interactive ? 'cursor-pointer hover:bg-white dark:hover:bg-slate-700 hover:shadow-soft transition-all group' : ''
      } ${className}`}
    >
      <Avatar src={avatar} name={name} className="w-8 h-8 ring-2 ring-white dark:ring-slate-700" />
      {!collapsed && (
        <div className="overflow-hidden flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{name}</p>
            {role && (
              <span className="text-2xs font-bold uppercase tracking-wider px-1.5 py-0.5 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded border border-slate-300 dark:border-slate-500 shrink-0">
                {role}
              </span>
            )}
          </div>
          {subtitle && (
            <p
              className={`text-xs text-slate-500 dark:text-slate-400 truncate ${
                interactive ? 'group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors' : ''
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default PersonCard;
