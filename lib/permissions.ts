import { User, Workspace } from '../types';
import { PLANS } from '../constants';

export type Action =
  | 'prompts:edit'
  | 'library:copy'
  | 'team:manage'
  | 'api-keys:manage'
  | 'api-keys:own'
  | 'plans:manage'
  | 'settings:general';

/**
 * Central permission check. Plain function — no hooks — usable in both
 * components and utility code.
 *
 * Note: the isSqemesAdmin superuser flag is intentionally excluded from this
 * function. It is an internal admin bypass and should be checked at the call
 * site alongside can() where needed.
 */
export function can(user: User, workspace: Workspace, action: Action): boolean {
  switch (action) {
    case 'prompts:edit':
      return user.role === 'admin' || user.role === 'editor';
    case 'library:copy':
      return workspace.isManaged || (PLANS[workspace.plan]?.libraryAccess ?? false);
    case 'team:manage':
      return user.role === 'admin';
    case 'api-keys:manage':
      return user.role !== 'member';
    // SQEM-328 — "my own connection" is a different question from "the workspace's provider keys",
    // and they only looked like one because they share a settings tab. Everyone may hold a key
    // bound to themselves; only non-members may touch the AI provider keys above, and only an admin
    // may mint a workspace-wide key (enforced in the page and in RLS, not here).
    case 'api-keys:own':
      return true;
    case 'plans:manage':
      return user.role === 'admin';
    case 'settings:general':
      return user.role !== 'member';
  }
}
