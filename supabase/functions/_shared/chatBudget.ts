/**
 * SQEM-501 — the chat/AI budget, per PERSON with a per-workspace ceiling.
 *
 * Until SQEM-501 the budget was 60 calls per minute for the whole WORKSPACE (`RATE_LIMIT_RPM`). The
 * SQEM-500 load test showed what that means: five people chatting non-stop in one workspace already
 * hit it, and with ten, 161 of 278 messages in a minute were refused. A person cannot type 20
 * messages a minute, so a per-person budget refuses runaway clients and scripts without ever touching
 * a human; the workspace ceiling keeps one customer from taking the shared database for themselves.
 *
 * Pure (no imports) so the decision can be unit-tested; `rateLimit.ts` does the counting.
 */
const intEnv = (name: string, fallback: number): number => {
  const raw = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Default per person and minute. Override with CHAT_RPM_PER_USER. */
export const CHAT_RPM_PER_USER = intEnv('CHAT_RPM_PER_USER', 20);
/**
 * Default per workspace and minute. Override with CHAT_RPM_PER_WORKSPACE. ⚠️ 600 = Business's 30
 * seats × the per-person 20, so a full Business workspace sits exactly at the ceiling — a choice, not
 * an accident; raise it if real usage says so.
 */
export const CHAT_RPM_PER_WORKSPACE = intEnv('CHAT_RPM_PER_WORKSPACE', 600);

/** Counter keys. Namespaced, so a person's chat budget never shares a bucket with anything else. */
export const personSeed = (workspaceId: string, userId: string) => `chat:${workspaceId}:${userId}`;
export const workspaceSeed = (workspaceId: string) => `chat-ws:${workspaceId}`;

/** A stable UUID from a string — the counter table keys by uuid. */
export async function uuidFromSeed(seed: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const h = Array.from(buf.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type BudgetVerdict = { ok: true } | { ok: false; scope: 'person' | 'workspace'; limit: number };

/** The person's own limit is reported first: it is the one they can do something about. */
export function budgetVerdict(personOk: boolean, workspaceOk: boolean,
  limits = { person: CHAT_RPM_PER_USER, workspace: CHAT_RPM_PER_WORKSPACE }): BudgetVerdict {
  if (!personOk) return { ok: false, scope: 'person', limit: limits.person };
  if (!workspaceOk) return { ok: false, scope: 'workspace', limit: limits.workspace };
  return { ok: true };
}

/** The 429 text. Says which budget ran out and that it resets within the minute. */
export function budgetMessage(v: Exclude<BudgetVerdict, { ok: true }>): string {
  return v.scope === 'person'
    ? `You have sent more than ${v.limit} requests in the last minute. It resets within 60 seconds — please try again then.`
    : `This workspace has sent more than ${v.limit} requests in the last minute. It resets within 60 seconds — please try again then.`;
}
