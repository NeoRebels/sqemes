/**
 * SQEM-111 / SQEM-237 — the storage key must not carry path separators or `..`.
 *
 * ⚠️ **This file has a twin: `supabase/functions/_shared/storageKey.ts`.** The Deno edge functions
 * and the browser bundle share no module system, so the rule exists twice — the same arrangement as
 * `lib/injectionScan.ts` and `_shared/injectionScan.ts`. `tests/unit/storageKey.test.ts` compares the
 * two bodies and fails when they diverge, which is what makes the duplication survivable: the
 * injectionScan pair relies on "hand-synced" and a hope, this pair does not.
 *
 * **Change one, change the other, or CI turns red.**
 *
 * Why it exists at all: SQEM-111 hardened the MCP upload paths and this was never applied to the
 * browser upload (`lib/api/files.ts`), which built the key raw for two years. Exploitability was
 * never demonstrated — a Supabase storage key is not a filesystem path, `..` resolves to nothing
 * there, and the `fileId` segment isolates every upload anyway. What was wrong is that a hardening
 * someone deemed necessary was applied to two of three call sites, which leaves nobody able to say
 * whether it is needed. Now it is applied everywhere and stated once.
 *
 * The visible file name is NOT sanitised — `workspace_files.name` keeps slashes and is what a client
 * sees. That separation is deliberate and load-bearing for SQEM-236: a path in the name is how an
 * Agent Skill's directory structure survives a round trip.
 */
export function safeStorageFileName(fileName: string): string {
  return fileName.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '_');
}
