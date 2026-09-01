// SQEM-292 — the checkbox, in one place.
//
// Written because it was missing. Before this there were **thirteen** hand-rolled checkboxes across
// the app in **six** different class combinations — and two different colours: `accent-brand-600`,
// which is the brand purple, and `accent-violet-600`, which is Tailwind's own. They look nearly
// identical on screen and are not the same value, so the odd ones out would not follow a brand
// change. Nobody chose that; it is what happens when every new list writes the markup again.
//
// **Reach for the primitives in this directory, and add to it when the one you need is missing.**
// That rule only works for elements that *have* a primitive — a missing one turns the rule into a
// suggestion, and the next person copies whichever example they found first.
//
// (SQEM-299 — this used to cite a file by name that the public export prunes, so a self-hoster read
// a pointer to something they do not have. The rule is short enough to state here instead, which is
// the better fix anyway: a reason beats a reference.)
// **Brand-only, and that is now the rule rather than a gap** (SQEM-307, 2026-09-01).
//
// SQEM-294 left four checkboxes on `accent-violet-600` because their whole cards were violet, and
// flagged the open question: two accents in one product. It was settled by asking whether the colours
// ever encoded a **state** — hover, active. They never did: no line in the repo uses both, and both
// follow the identical `bg-X-600 hover:bg-X-700` shape. Same role, different colour. So violet was
// drift, and those four are on the primitive now.
//
// ⚠️ **Violet still exists, and it means something.** It marks the *assistant* kind (against
// prompt=brand, skill=emerald), the *managed* plan, one of six avatar tints and one category colour.
// ⛔ Those are categorical, not accent — a `tone` prop here would let that meaning leak back into a
// control that has none. If a checkbox ever needs to look different, the reason will be its context,
// and the context is where it belongs.
export default function Checkbox({
  checked,
  onChange,
  disabled = false,
  align = 'top',
  className = '',
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /**
   * SQEM-294 — where the box sits against its label.
   *
   * `top` (the default) nudges it down by `mt-0.5` for the common case: two lines of text beside it.
   * `center` is for a single-line row, where that nudge reads as crooked.
   *
   * ⚠️ **A prop rather than something a call site can pass in `className`.** Tailwind emits `mt-0`
   * and `mt-0.5` at equal specificity, so which one wins is decided by their order in the generated
   * stylesheet, not by the order of the class list — an override that appears to work and does so by
   * accident. The primitive owns the value; the call site picks between two named cases.
   */
  align?: 'top' | 'center';
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
      // The offset lives here rather than at the call site because these sit beside two lines of text
      // almost everywhere they appear, and optically centring them per list is how the drift began.
      className={`${align === 'top' ? 'mt-0.5' : ''} w-4 h-4 rounded accent-brand-600 shrink-0 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
    />
  );
}
