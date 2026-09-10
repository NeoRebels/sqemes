import { createAdminClient } from './supabase-admin.ts';

const RATE_LIMIT_RPM = parseInt(Deno.env.get('RATE_LIMIT_RPM') || '60', 10);

/**
 * Per-workspace request budget, one-minute buckets.
 *
 * ⛔ **This was inert from February to September 2026, and the reason is worth carrying.** The SQL
 * function named a parameter `window_key`, exactly like the column, so its body was ambiguous and it
 * threw `42702` on every call. The `catch` below then returned `true` every time — the limit existed
 * as a table, as code and as an env var, but never as an effect. Nothing failed; users got their
 * answers; no test broke. It surfaced only because a security incident sent somebody into the edge
 * logs looking for 400s (SQEM-335).
 *
 * ⛔ **`marketplace-vote` used to call the RPC itself instead of coming through here**, with its own
 * copy of the argument names — so it was broken in exactly the same way, and worse: it destructured
 * only `{ data: ok }`, discarding the error, so its fail-open was not even logged. On a **public**
 * endpoint (`verify_jwt = false`, CORS `*`) — the one place a limit is actually aimed at strangers.
 * It now comes through this function; `limit` exists so it can keep its own budget without keeping
 * its own call.
 *
 * ⚠️ **The argument names below are load-bearing.** They are the function's parameter names, and the
 * repair had to rename them — `create or replace` cannot change a parameter name, so the function was
 * dropped and recreated with a `p_` prefix. Changing one side without the other reproduces the exact
 * failure this fixed, in a form that again looks like nothing is wrong.
 */
/**
 * ⚠️ **`subjectId`, not `workspaceId` — the old name was not true of every caller.**
 *
 * Three callers pass a workspace id; `send-invite-email` passes the inviting **user's** id, and has
 * since it was written. That is arguably the better bucket there — invitations are sent by a person,
 * not by a workspace — so the behaviour is left exactly as it was and only the name is corrected.
 *
 * ⛔ The column it lands in is still called `workspace_id`, which now understates what it holds. That
 * is deliberate: renaming a column on a deployed table to fix a comment is the expensive half of a
 * cosmetic problem. **Whoever moves this to per-key budgets (SQEM-352) should fix the column then**,
 * when the table is being reshaped anyway.
 */
export async function checkRateLimit(subjectId: string, limit: number = RATE_LIMIT_RPM): Promise<boolean> {
  const adminClient = createAdminClient();
  const window = Math.floor(Date.now() / 60_000); // 1-minute bucket

  const { data, error } = await adminClient.rpc('check_and_increment_rate_limit', {
    p_ws_id:      subjectId,
    p_window_key: window,
    p_rate_limit: limit,
  });

  if (error) {
    /**
     * ⛔ **Fail open, deliberately, and it stays that way.** A rate limiter that locks people out
     * when *it* is unhealthy is worse than the thing it protects against.
     *
     * ⚠️ The lesson from SQEM-335 is not the direction of this failure — it is that nobody noticed
     * it for seven months. The fix for that is NOT here: it is the self-test inside the SQEM-335
     * migration, which executes this function while applying and turns a broken limiter into a red
     * deploy on every database it touches, including every self-hosted instance.
     *
     * A counter or an alert was considered instead and rejected: the failure class that actually bit
     * us is settled at migration time, and a table nobody queries would only move the problem up one
     * level. What a *silent* limiter looks like in operation is answered by counting real calls
     * (SQEM-351), not by recording our own errors.
     */
    console.error('[rate-limit] check failed, allowing request:', error.message);
    return true;
  }

  return data === true;
}
