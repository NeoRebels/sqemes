/**
 * SQEM-597 — which workspace file a style's logo name means. Pure (no Supabase import), so unit tests
 * can import it: `lib/logoImage.ts` pulls in the API layer, which throws at import time without env
 * vars — green locally, red in CI.
 */
import type { WorkspaceFile } from '../types';

/** Exact name first, then the bare file name ("logo.png" finds "brand/logo.png"); case-insensitive. */
export function findLogoFile(name: string, files: WorkspaceFile[]): WorkspaceFile | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const base = (n: string) => n.toLowerCase().split('/').pop() ?? '';
  return files.find(f => f.name.toLowerCase() === want)
    ?? files.find(f => base(f.name) === base(want))
    ?? null;
}

