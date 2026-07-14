// SQEM-123 — shared self-host update-status hook.
//
// Both the sidebar footer version indicator and the Settings → About panel need the
// same "is a newer release available?" answer. This hook wraps `checkForUpdate()` behind
// a module-level cache so all consumers share a SINGLE GitHub Releases fetch per session
// (the latest release doesn't change mid-session). Self-host only + fail-silent, inherited
// from `checkForUpdate()`.

import { useEffect, useState } from 'react';
import { IS_SELF_HOSTED } from '../lib/env';
import { checkForUpdate, type UpdateStatus } from '../lib/version';

let cached: UpdateStatus | null = null;
let inFlight: Promise<UpdateStatus | null> | null = null;

function loadOnce(): Promise<UpdateStatus | null> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = checkForUpdate()
      .then((res) => {
        if (res) cached = res;
        return res;
      })
      .catch(() => null);
  }
  return inFlight;
}

// Returns the shared update status, or null until known / when not applicable (Cloud,
// no feed configured, or the feed is unreachable). Never throws.
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(cached);

  useEffect(() => {
    if (!IS_SELF_HOSTED) return;
    let active = true;
    loadOnce().then((res) => {
      if (active && res) setStatus(res);
    });
    return () => {
      active = false;
    };
  }, []);

  return status;
}

export default useUpdateStatus;
