// SQEM-292 — the checkbox, in one place.
//
// Written because it was missing. Before this there were **thirteen** hand-rolled checkboxes across
// the app in **six** different class combinations — and two different colours: `accent-brand-600`,
// which is the brand purple, and `accent-violet-600`, which is Tailwind's own. They look nearly
// identical on screen and are not the same value, so the odd ones out would not follow a brand
// change. Nobody chose that; it is what happens when every new list writes the markup again.
//
// `AGENTS.md` already says to prefer the primitives in `components/ui/`. That rule only works for
// elements that *have* a primitive — a missing one turns the rule into a suggestion, and the next
// person copies whichever example they found first.
export default function Checkbox({
  checked,
  onChange,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Extra classes. Layout only — colour and size belong to the primitive, or it stops being one. */
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      // `mt-0.5` is here rather than at the call site because these sit beside two lines of text
      // almost everywhere they appear, and optically centring them per list is how the drift began.
      className={`mt-0.5 w-4 h-4 rounded accent-brand-600 shrink-0 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
    />
  );
}
