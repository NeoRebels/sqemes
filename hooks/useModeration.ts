// SQEM-666 — whether moderation is on in the active workspace and whether the signed-in person moderates.
// The moderator list is read once per workspace and shared by every page (Settings refreshes it after
// a change). Off on self-host: access and groups are Cloud-only there, and so is moderation.
import { useEffect, useState } from 'react';
import { IS_SELF_HOSTED } from '../lib/env';
import { fetchModeratorIds } from '../lib/api/moderation';
import { isModerator } from '../lib/moderation';
import type { User, Workspace } from '../types';

const cache = new Map<string, string[]>();
const listeners = new Set<() => void>();

/** Settings calls this after saving, so every open page sees the new list. */
export function setCachedModerators(workspaceId: string, ids: string[]) {
  cache.set(workspaceId, ids);
  listeners.forEach(l => l());
}

export function useModeration(workspace: Workspace | null | undefined, user: User | null | undefined) {
  const wsId = workspace?.id;
  const [ids, setIds] = useState<string[]>(() => (wsId && cache.get(wsId)) || []);

  useEffect(() => {
    if (!wsId || IS_SELF_HOSTED) return;
    let alive = true;
    const sync = () => { if (alive) setIds(cache.get(wsId) ?? []); };
    listeners.add(sync);
    if (cache.has(wsId)) sync();
    else void fetchModeratorIds(wsId).then(list => { cache.set(wsId, list); sync(); });
    return () => { alive = false; listeners.delete(sync); };
  }, [wsId]);

  const enabled = !IS_SELF_HOSTED && !!workspace?.moderationNew;
  return {
    /** The switch for new playbooks and personas. */
    enabled,
    /** SQEM-667 — the switch for changes to shared ones; only together with the first. */
    changes: enabled && !!workspace?.moderationChanges,
    moderatorIds: ids,
    /** Admins always; listed editors. Independent of the switch: pending items can outlive it. */
    moderator: !IS_SELF_HOSTED && !!user && isModerator(user.role, user.id, ids),
  };
}
