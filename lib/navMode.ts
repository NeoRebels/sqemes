import type { UserRole } from '../types';

/**
 * SQEM-548 — the two navigation modes of redesign C: **Work** (do the job) and **Manage** (look after
 * what the team uses). Every page belongs to exactly ONE
 * mode, so no page has two menu entries and the active mode can always be read off the route.
 *
 * ⛔ A mode is a navigation filter, not a permission. It only decides which links the sidebar shows;
 * what someone may do is still `can()` and RLS. Hiding a link here protects nothing.
 *
 * Members never get Manage: they see one list (Start, Chat, Playbooks, Personas) — the same pages they
 * reach today, so for them nothing moves.
 *
 * Pure on purpose (no store, no Supabase import), so it is unit-testable without env vars.
 */
export type NavMode = 'work' | 'manage';
export type NavRoute = '/' | '/chat' | '/overview' | '/playbooks' | '/personas' | '/files' | '/library';

/** Where a click on the mode switch lands. SQEM-552 — Manage lands on its Overview. */
export const MODE_HOME: Record<NavMode, NavRoute> = { work: '/', manage: '/overview' };

export const NAV_MODE_STORAGE_KEY = 'sqemes_nav_mode';

/** Editors and admins manage; the same line as `prompts:edit` in lib/permissions.ts. */
export function canManage(role: UserRole): boolean {
  return role === 'admin' || role === 'editor';
}

const startsWithSegment = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * The mode a route belongs to, or `null` for a neutral route (Settings, /design, an invitation, 404)
 * that keeps whichever mode was last in use.
 */
export function modeForPath(path: string): NavMode | null {
  if (path === '/' || startsWithSegment(path, '/chat')) return 'work';
  if (['/overview', '/playbooks', '/personas', '/files', '/library'].some(base => startsWithSegment(path, base))) return 'manage';
  return null;
}

/** The mode in effect: the route's own mode, else the remembered one — and never Manage without the right. */
export function resolveMode(path: string, role: UserRole, remembered: NavMode | null): NavMode {
  if (!canManage(role)) return 'work';
  return modeForPath(path) ?? remembered ?? 'work';
}

/** The main links, in order. `marketplace` is false on a self-host instance without one (SQEM-178). */
export function navRoutes(mode: NavMode, role: UserRole, opts: { marketplace: boolean }): NavRoute[] {
  if (!canManage(role)) return ['/', '/chat', '/playbooks', '/personas'];
  if (mode === 'work') return ['/', '/chat'];
  return ['/overview', '/playbooks', '/personas', '/files', ...(opts.marketplace ? (['/library'] as const) : [])];
}

/** The remembered mode, or null when storage is empty, unreadable or holds something else. */
export function readRememberedMode(): NavMode | null {
  try {
    const v = window.localStorage.getItem(NAV_MODE_STORAGE_KEY);
    return v === 'work' || v === 'manage' ? v : null;
  } catch {
    return null;
  }
}

export function writeRememberedMode(mode: NavMode): void {
  try {
    window.localStorage.setItem(NAV_MODE_STORAGE_KEY, mode);
  } catch {
    // Private window or blocked storage: the mode is then only kept for this page load. Harmless.
  }
}
