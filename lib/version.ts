// SQEM-118 — self-host version + update check.
//
// The running version is inlined at build (VITE_APP_VERSION, from package.json). On a
// self-hosted instance we optionally check a release feed (GitHub Releases API of the
// public repo) to tell the operator when a newer version exists. The check is a plain
// client-side GET — no data is sent, no server phone-home — and fails silent.

import { IS_SELF_HOSTED } from './env';

export const CURRENT_VERSION: string = import.meta.env.VITE_APP_VERSION || '0.0.0';

// Releases API endpoint. Empty ⇒ no auto-check (just show the current version). Set at
// go-public to the public repo's releases API, e.g.
// https://api.github.com/repos/<org>/<repo>/releases/latest
const CHECK_URL: string = import.meta.env.VITE_UPDATE_CHECK_URL?.trim() || '';

// "How to update" docs/wiki, shown when an update is available.
export const UPDATE_DOCS_URL: string =
  import.meta.env.VITE_UPDATE_DOCS_URL?.trim() || 'https://github.com/NeoRebels/sqemes';

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

// Parse "v1.2.3" / "1.2.3" → [1,2,3]; null if not semver-ish.
function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// True if version `a` is strictly newer than `b`.
export function isNewer(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

// Self-host + configured only. Returns null when not applicable or the feed is unreachable
// (offline, CORS, feed not public yet) — callers then just show the current version.
export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateStatus | null> {
  if (!IS_SELF_HOSTED || !CHECK_URL) return null;
  try {
    const res = await fetch(CHECK_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const rec = data as Record<string, unknown>;
    const latestRaw = (rec.tag_name || rec.name || rec.version) as string | undefined;
    if (!latestRaw || typeof latestRaw !== 'string') return null;
    const latest = latestRaw.replace(/^v/i, '');
    return { current: CURRENT_VERSION, latest, updateAvailable: isNewer(latest, CURRENT_VERSION) };
  } catch {
    return null; // fail silent
  }
}
