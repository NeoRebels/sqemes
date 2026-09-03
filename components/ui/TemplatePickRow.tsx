import Checkbox from './Checkbox';
import KindBadge from './KindBadge';
import type { Prompt } from '../../types';

/**
 * SQEM-330 — one row of a template picker, wherever templates are picked.
 *
 * Written because the attach picker in the persona editor and the Persona Wizard grew the same row
 * twice, three days apart, and had already begun to differ: one used the shared `Checkbox`, the
 * other a hand-rolled square; one warned about a missing description, the other did not.
 *
 * ⚠️ This is a **row**, not a picker. SQEM-329 argued against sharing `TemplateLaunchModal` because
 * it carries a second step for variables — sharing it would have meant teaching it a mode. A row has
 * no such baggage: it is presentation, and presentation is exactly what should not be re-typed.
 *
 * ⚠️ **The markup follows the Chat modal's row exactly** (`TemplateLaunchModal`) — same padding,
 * same badge-then-title line, and a description line **only when there is one**. That last part is
 * a reversal: this row first carried an amber "no description" warning, which made it the one
 * picker in the product that looked different from the other two. The warning has not been lost,
 * it has moved to where it can be acted on — the route row in the persona editor says it beside
 * the empty condition it actually affects.
 */
export default function TemplatePickRow({
  template,
  /** Omit for a picker that acts on click; pass a boolean for a multi-select list. */
  selected,
  onClick,
  disabled = false,
}: {
  template: Prompt;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const multi = selected !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left ${multi ? 'pl-3' : 'pl-4'} pr-2 py-3 rounded-xl border transition-all flex items-center gap-3 disabled:opacity-50 ${
        selected
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
          : 'border-transparent hover:border-slate-200 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
      }`}
    >
      {multi && (
        /* Presentational only: the whole row is the button, so the box must not take the click
           itself — hence `pointer-events-none` and a no-op handler. */
        <span className="shrink-0 pointer-events-none">
          <Checkbox checked={!!selected} onChange={() => {}} align="center" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 mb-0.5">
          <KindBadge kind={template.kind} />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{template.title}</span>
        </span>
        {template.description && (
          <span className="block text-xs text-slate-500 dark:text-slate-400 line-clamp-1 ml-0.5">{template.description}</span>
        )}
      </span>
    </button>
  );
}
