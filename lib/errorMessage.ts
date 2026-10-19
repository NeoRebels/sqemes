/**
 * SQEM-529 — the text of anything that was thrown, or the fallback when it carries none.
 *
 * ⚠️ Supabase hands back its errors as plain objects (`{ message, code, details, hint }`), not as
 * `Error` instances — postgrest-js only constructs a `PostgrestError` in `throwOnError` mode, which this
 * codebase does not use. Every `throw error` in `lib/api/` therefore throws a plain object, and
 * `e instanceof Error ? e.message : 'Import failed'` replaced each database failure with the fallback:
 * the user saw "Import failed" and nothing else. Imports nothing, so tests can use it without env vars.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e;
  const message = (e as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
