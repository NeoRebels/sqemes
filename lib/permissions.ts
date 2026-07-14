import { User, Workspace } from '../types';
import { PLANS } from '../constants';

export type Action =
  | 'prompts:edit'
  | 'library:copy'
  | 'team:manage'
  | 'api-keys:manage'
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
    case 'plans:manage':
      return user.role === 'admin';
    case 'settings:general':
      return user.role !== 'member';
  }
}
