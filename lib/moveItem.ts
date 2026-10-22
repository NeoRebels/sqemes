/**
 * SQEM-540 — move one entry of a list to another index, returning a new array.
 *
 * Shared by drag-and-drop and by the "Move up / Move down" buttons that give the same reordering to a
 * keyboard and a touch screen (WCAG 2.5.7: dragging must not be the only way). Out-of-range indices
 * return the list unchanged rather than inventing a position.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
