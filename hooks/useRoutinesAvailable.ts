import { useEffect, useState } from 'react';
import { IS_SELF_HOSTED } from '../lib/env';
import { fetchRoutinesAvailable } from '../lib/api/routines';

/**
 * SQEM-679 — Routines are shown where they run: always on Cloud, on self-host once the instance has its
 * two Vault entries (`routines_available()`, set by `selfhost/init/apply.sh`).
 * ⚠️ Asked only when signed in (`ready`): the function is not open to anonymous callers, and a "no" before
 * the login would hide Routines for the rest of the visit. Only a "yes" is kept for the page load.
 */
let known: boolean | null = null;

export function useRoutinesAvailable(ready = true): boolean {
  const [available, setAvailable] = useState(!IS_SELF_HOSTED || known === true);
  useEffect(() => {
    if (!IS_SELF_HOSTED || !ready || known === true) return;
    let live = true;
    void fetchRoutinesAvailable().then(v => {
      if (v) known = true;
      if (live) setAvailable(v);
    });
    return () => { live = false; };
  }, [ready]);
  return available;
}
