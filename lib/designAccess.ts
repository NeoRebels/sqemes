/**
 * SQEM-545 — who may open the design-system page (`/design`).
 *
 * Cloud: Sqemes admins only — it is a working page for whoever builds the product, not a customer
 * feature. Self-host: the instance's admins (an operator who customises the UI needs the same
 * reference). A dev build: everybody, so the page is there while a component is being written.
 * The page holds components and tokens only — no data — so showing it costs nothing but clutter,
 * which is why it is not in the sidebar.
 */
export function canSeeDesignSystem(opts: {
  isSqemesAdmin: boolean;
  isSelfHosted: boolean;
  canManageTeam: boolean;
  isDev: boolean;
}): boolean {
  if (opts.isDev) return true;
  return opts.isSelfHosted ? opts.canManageTeam : opts.isSqemesAdmin;
}
