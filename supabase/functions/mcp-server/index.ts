import { createAdminClient } from '../_shared/supabase-admin.ts';
import { shouldForward, forwardToHome, SERVED_REGION_HEADER } from '../_shared/regionForward.ts';
import { MCP_MAX_BODY_BYTES, declaredLength, readJsonCapped, tooLargeMessage } from '../_shared/requestBody.ts';
import {
  createLibraryReader, hiddenFromCaller, toSlug, renderContextBlocks,
} from '../_shared/libraryQueries.ts';
import { isWorkspaceSubscriptionActive } from '../_shared/subscription.ts';
import { toolAnnotations } from '../_shared/toolAnnotations.ts';
import {
  type Capability, TOOL_CAPABILITY, LIBRARY_TOOL_DEFS, runLibraryTool, libraryError, writeRefusalMessage,
} from '../_shared/libraryActions.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MCP_VERSION = '2025-03-26';

// ---- JSON-RPC helpers ----

function rpcResult(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function rpcError(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: 200, // MCP errors are always HTTP 200
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// 401 with the OAuth resource-metadata challenge. Returned for missing, malformed,
// invalid, or expired credentials so spec-compliant MCP clients (re)authorize.
function authChallenge(): Response {
  // SQEM-088 — advertise the custom domain (PUBLIC_API_URL) when set, so the resource
  // metadata pointer matches the domain the client connected to; else the project URL.
  const publicBase = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
  const oauthBase = `${publicBase}/functions/v1/mcp-oauth`;
  return new Response(null, {
    status: 401,
    headers: {
      ...CORS,
      'WWW-Authenticate': `Bearer realm="sqemes", resource_metadata="${oauthBase}/.well-known/oauth-protected-resource"`,
    },
  });
}

// ---- MCP connection scopes (SQEM-064) ----
// Each tool/read-method requires a capability; a connection grants a subset.
const FULL_SCOPES: Capability[] = ['read', 'create', 'update', 'delete'];
/**
 * SQEM-352 — per-connection ceilings, one-minute windows.
 *
 * ⛔ **Not calibrated.** See the note at the check itself: these guard against a runaway loop, not
 * against a heavy user, and they are meant to be tightened once SQEM-351 has measured what a real
 * working minute looks like. Env-configurable so that tightening needs no migration.
 */
const MCP_READ_RPM  = parseInt(Deno.env.get('MCP_READ_RPM')  || '600', 10);
const MCP_WRITE_RPM = parseInt(Deno.env.get('MCP_WRITE_RPM') || '120', 10);

// ⚠️ SQEM-332 — a third list naming the tools was tried here and removed again: it would have been
// one more place to keep in step, which is the disease rather than the cure. The two halves that
// must agree are `TOOL_CAPABILITY` and `LIBRARY_TOOL_DEFS` — both in `_shared/libraryActions.ts`
// since SQEM-561 — and `tests/unit/mcpToolCapability.test.ts` reads that file as text to compare
// them (no import: npm: specifiers, and this module calls `Deno.serve` at load).
const READ_METHODS = new Set(['prompts/list', 'prompts/get', 'resources/list', 'resources/read']);

// ---- Helpers ----

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function substituteVariables(content: string, inputs: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, name) => inputs[name] ?? '');
}

function buildArguments(variables: any[]): any[] {
  return variables
    .filter((v: any) => v.type !== 'file')
    .map((v: any) => ({
      name: v.name,
      description: v.label || v.name,
      required: !v.defaultValue,
    }));
}

// The `initialize` answer. A function so the early return above the gates (SQEM-481) and nothing
// else builds it.
function initializeResult() {
  return {
    protocolVersion: MCP_VERSION,
    capabilities: { prompts: {}, resources: {}, tools: {} },
    // ⛔ SQEM-526 — NO `instructions`. This used to hand out LIBRARY_SYSTEM_PROMPT ("Before you write
    // … anything substantial … first search the Sqemes playbooks"). MCP client guidelines say a server
    // must not push a client into calls the user did not ask for. The text stays where a
    // person puts it on purpose — the copy block in Settings, for their own or their organisation's
    // Claude instructions — and in Sqemes' own chat. Cost measured beforehand: SQEM-468 found clients
    // ignore what the server hands them here (tests/unit/mcpToolTriggers.test.ts).
    // SQEM-089 — brand the connector. `icons` (MCP SEP-973) is additive metadata a
    // client MAY render in its connector list; PNG over HTTPS is the safest, most
    // widely-supported form, served credential-free from our own domain. `sizes` is
    // omitted deliberately — its format varies across spec revisions (string vs array)
    // and `'any'` is for scalable SVG, so a strict client could reject a raster icon
    // declared with it; omitting = "usable at any size".
    serverInfo: {
      name: 'sqemes',
      title: 'Sqemes',
      version: '2.0.0',
      websiteUrl: 'https://app.sqemes.com',
      icons: [
        { src: 'https://app.sqemes.com/logo-favicon-V2.png', mimeType: 'image/png' },
      ],
    },
  };
}

// ---- Main handler ----

/**
 * SQEM-481 — `Server-Timing` on every answer: where the time of a call went, measured inside the
 * function. `scripts/mcp-latency.mjs` reads it from outside, so a slow call can be attributed to auth,
 * the gates, the access sets or the handler without guessing. Durations only, no data.
 */
Deno.serve(async (incoming) => {
  // SQEM-510/513 — a call that landed outside the database's region (Claude calls from the US, European
  // callers in Frankfurt) is re-sent to the home region, eu-west-1; see _shared/regionForward.ts. Only authenticated POSTs do database
  // work — the handshake answers and the auth challenge are cheaper served where they arrive.
  let req = incoming;
  const region = Deno.env.get('SB_REGION');
  const authed = req.method === 'POST' && /^Bearer\s+sqm_live_/i.test(req.headers.get('Authorization') ?? '');
  // SQEM-530 — a body declared over the ceiling is not carried across the ocean only to be refused;
  // it is refused here, by `handle`, without being read.
  const oversized = (declaredLength(req.headers) ?? 0) > MCP_MAX_BODY_BYTES;
  if (!oversized && shouldForward(req, region, authed)) {
    const body = await req.arrayBuffer();
    const publicBase = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim();
    const forwarded = await forwardToHome(req, body, publicBase);
    if (forwarded) return forwarded;
    req = new Request(req.url, { method: req.method, headers: req.headers, body }); // forward failed — serve here
  }
  const t0 = performance.now();
  const marks: string[] = [];
  let last = t0;
  const mark = (name: string) => {
    const now = performance.now();
    marks.push(`${name};dur=${(now - last).toFixed(0)}`);
    last = now;
  };
  const call: CallNote = {};
  const res = await handle(req, mark, call);
  marks.push(`total;dur=${(performance.now() - t0).toFixed(0)}`);
  if (call.tool) logCall('end', call.tool, { status: res.status, ms: Math.round(performance.now() - t0) });
  try {
    res.headers.set('Server-Timing', marks.join(', '));
    if (region) res.headers.set(SERVED_REGION_HEADER, region); // where the work actually ran
  } catch { /* immutable headers — skip */ }
  return res;
});

/**
 * SQEM-530 — one line when a tool call starts and one when it ends: the tool, the body size, the
 * status, the duration and the worker's heap. A call that dies with 546 ("Memory limit exceeded",
 * 256 MB per worker) left no trace of which tool it was — nothing named it. A
 * worker killed mid-call never writes the end line, so the START line carries the size: the last
 * start without an end is the call that took the worker down.
 * ⛔ Names and numbers only — never `args`, a file name or any content (tests/unit/mcpCallLog.test.ts).
 */
type CallNote = { tool?: string };
function logCall(phase: 'start' | 'end' | 'refused', tool: string, extra: Record<string, number | null>) {
  // `rss` reads 0 on Supabase's hosted runtime; the isolate's heap is what fills up.
  let heapMb: number | null = null;
  try { heapMb = Math.round(Deno.memoryUsage().heapUsed / 1048576); } catch { /* not available */ }
  console.log(`[mcp-call] ${JSON.stringify({ phase, tool, ...extra, heapMb })}`);
}

async function handle(req: Request, mark: (name: string) => void, call: CallNote): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  // 1. Authenticate via sqemes API key
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) {
    return authChallenge();
  }
  const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!rawKey.startsWith('sqm_live_')) {
    return authChallenge();
  }

  const adminClient = createAdminClient();
  const keyHash = await hashKey(rawKey);

  // SQEM-481 — the body is read while the key is looked up; neither needs the other. The key still
  // decides first: an unauthenticated caller gets the challenge, never a parse error.
  const [{ data: keyRow, error: keyErr }, parsed] = await Promise.all([
    adminClient
      .from('sqemes_api_keys')
      .select('id, workspace_id, name, scopes, expires_at, is_oauth, user_id, created_at, last_used_at')
      .eq('key_hash', keyHash)
      .single(),
    readJsonCapped(req), // SQEM-530 — at most MCP_MAX_BODY_BYTES; see _shared/requestBody.ts
  ]);

  if (keyErr || !keyRow) {
    return authChallenge();
  }

  // Expired connection — challenge so OAuth clients re-authorize (SQEM-064).
  if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() <= Date.now()) {
    return authChallenge();
  }

  /**
   * SQEM-346 — **every key belongs to exactly one person.**
   *
   * `user_id` is `NOT NULL` since the SQEM-346 migration, so this cannot fire. It stays because
   * everything below reads `mcpUserId` as *a person*: a null slipping past here would not throw, it
   * would silently restore the workspace-wide key — a connection that wrote without any role being
   * checked. A guard whose absence fails **open** is worth one line even when the database already
   * makes it impossible.
   */
  const keyUserId: string | null = (keyRow as { user_id?: string | null }).user_id ?? null;
  if (!keyUserId) {
    return authChallenge();
  }

  /**
   * SQEM-348 — **"never expires" means never, while it is being used.**
   *
   * Owner decision 2026-09-09: the lifetime stays selectable as "never", but 90 days without a single
   * call and the connection stops answering. That closes the case the user cannot see — somebody
   * disconnects the server in their client, which tells us nothing, and the refresh token lives on.
   *
   * ⚠️ Read BEFORE the `last_used_at` write below, or every key looks fresh forever.
   * ⚠️ `last_used_at` is null on a key that was issued and never used; `created_at` is then the
   * honest starting point, not "unknown, let it through".
   *
   * Refusing rather than deleting is deliberate: a refused key can be re-authorised in seconds, a
   * deleted row cannot be brought back. Pruning rows is a separate decision with a separate blast
   * radius, and it is NOT taken here.
   */
  const IDLE_LIMIT_MS = 90 * 24 * 60 * 60 * 1000;
  const lastSeen: string | null =
    (keyRow as { last_used_at?: string | null }).last_used_at
    ?? (keyRow as { created_at?: string | null }).created_at
    ?? null;
  if (lastSeen && Date.now() - new Date(lastSeen).getTime() > IDLE_LIMIT_MS) {
    return authChallenge();
  }

  const { workspace_id: workspaceId, id: keyId } = keyRow;
  // Granted capabilities. SQEM-111 — an OAuth connection always carries explicit scopes
  // (minted with ['read']), so an empty/null set on one is anomalous (tampered) → grant nothing.
  // Only legacy manual keys (pre-SQEM-064, non-OAuth) keep the full-access default.
  const scopes: string[] = Array.isArray(keyRow.scopes) && keyRow.scopes.length > 0
    ? keyRow.scopes
    : (keyRow.is_oauth ? [] : FULL_SCOPES);
  /**
   * SQEM-481 — `last_used_at` is written at most once a minute, and not in the caller's path.
   *
   * It used to be an awaited write on every call: one round trip that the answer waited for, to move
   * a timestamp by seconds. Its two readers are the 90-day idle limit above (SQEM-348) and the "last
   * used" column in Settings; a minute of resolution is far inside what either can tell apart.
   * `EdgeRuntime.waitUntil` keeps the write alive after the response — an un-awaited promise alone
   * can be torn down with it. Where the runtime lacks it (local tests), the write is awaited as before.
   */
  const lastUsedRaw = (keyRow as { last_used_at?: string | null }).last_used_at ?? null;
  if (!lastUsedRaw || Date.now() - new Date(lastUsedRaw).getTime() > 60_000) {
    const touch = Promise.resolve(
      adminClient.from('sqemes_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyId),
    ).catch((e: Error) => console.error('[mcp] last_used_at write failed:', e?.message));
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(touch); else await touch;
  }
  mark('auth');

  // 2. Parse JSON-RPC request
  if (!parsed.ok) {
    if (parsed.tooLarge) {
      logCall('refused', '(too large)', { bytes: parsed.bytes });
      return rpcError(null, -32600, tooLargeMessage(parsed.bytes));
    }
    return rpcError(null, -32700, 'Parse error');
  }
  const rpc = parsed.v as { jsonrpc: string; id?: unknown; method: string; params?: any };

  const { id, method, params } = rpc;

  /**
   * SQEM-481 — the handshake answers before any per-request work. `initialize` and `ping` carry no
   * workspace data and were already exempt from the paywall and the call count; they no longer pay
   * for the access sets and the role lookup either (~5 round trips that nothing below them read).
   * `notifications/initialized` is the same class — a notification with an empty answer — and joins
   * them: counting it as a "read" (as it was) inflated the very number SQEM-351 collects.
   */
  if (method === 'ping') {
    return rpcResult(id, {});
  }
  if (method === 'initialize') {
    return rpcResult(id, initializeResult());
  }
  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // SQEM-142 — per-user template access. OAuth connections carry the authorizing user; restrict
  // templates to what that user may access.
  const mcpUserId: string = keyUserId;

  /**
   * SQEM-481 — the access sets and the role are started now and awaited after the gates.
   *
   * They are reads with no side effect, so starting them before the paywall costs nothing but wasted
   * work on a refused call, and it takes them out of the sequential chain (paywall → count → budget →
   * access → role), which was ~9 round trips one after another before a handler started. The gates
   * themselves keep their order — the count must stay after the paywall and before the budget, for
   * the reasons written at each of them.
   * ⚠️ The `.catch` on the copies marks a rejection as handled when a gate returns early; awaiting the
   * originals below still throws, exactly as the inline awaits did.
   */
  const libP = createLibraryReader({ client: adminClient, workspaceId, userId: mcpUserId });
  const memberP = Promise.resolve(adminClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', mcpUserId)
    .maybeSingle());
  libP.catch(() => {});
  memberP.catch(() => {});

  // SQEM-083 — server-side paywall: a lapsed workspace may handshake (initialize/ping)
  // but can't use any data method until it has an active subscription.
  if (!(await isWorkspaceSubscriptionActive(adminClient, workspaceId))) {
    return rpcError(id, -32003, 'This sqemes workspace has no active subscription. Resubscribe at app.sqemes.com to use MCP.');
  }

  /**
   * SQEM-351 — count the call. **Only count it.** Nothing here refuses anything.
   *
   * ⛔ It exists so SQEM-352 can pick a limit from a measurement instead of a guess. `last_used_at`
   * says *that* a key was used, never *how often*, and a limit chosen without that number either
   * catches nobody or lands in the middle of a real session — where it reads as a broken product
   * rather than a rule.
   *
   * ⚠️ **After the paywall gate, not before.** A lapsed workspace's refused calls are not the usage
   * we are trying to size a budget against; counting them would inflate exactly the number the next
   * ticket depends on.
   *
   * ⚠️ **`initialize` and `ping` are skipped on purpose.** They are protocol overhead a client emits
   * on its own schedule, and they would swamp the signal we actually want.
   *
   * The capability comes from `TOOL_CAPABILITY`, never re-derived — re-deriving that mapping in a
   * second place is what SQEM-332 and SQEM-349 each cost.
   */
  {
    const counted = method === 'tools/call'
      ? TOOL_CAPABILITY[(params as { name?: string } | undefined)?.name ?? '']
      : 'read';

    if (counted) {
      /**
       * SQEM-351 — count the call. **Counting refuses nothing.**
       *
       * ⛔ **Recorded BEFORE the budget check, and that order is the point.** A call the budget turns
       * away is still demand — arguably the most interesting kind, because it is exactly what a
       * limit would have to accommodate. Counting only what got through would measure the limit
       * instead of the need, and then SQEM-352's calibration would justify itself with its own
       * effect.
       *
       * ⚠️ `initialize` and `ping` are skipped: protocol overhead on the client's own schedule, which
       * would swamp the signal. Best-effort — a failed count must never cost the caller their answer.
       * The capability comes from `TOOL_CAPABILITY`, never re-derived.
       *
       * ⭐ SQEM-500 — **started here, no longer waited for.** Under load (staging, 100 concurrent) every
       * request in this chain queued for PostgREST's share of the connections; the count was one of
       * three in a row, and the answer does not depend on it. It is still *started* before the budget
       * check, so a refused call is still counted. `EdgeRuntime.waitUntil` keeps it alive after the
       * response; without the runtime (local tests) it is awaited as before. The budget has its own
       * counter (`mcp_rate_counters`), so it does not see fewer calls because of this.
       */
      const count = Promise.resolve(adminClient.rpc('record_mcp_call', { p_key_id: keyId, p_capability: counted }))
        .catch((e: Error) => console.error('[mcp-metrics] failed to record call:', e?.message));
      const rtCount = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (rtCount?.waitUntil) rtCount.waitUntil(count); else await count;

      /**
       * SQEM-352 — the budget, checked after the call is counted and before the work is done.
       *
       * ⛔ **These numbers are a ceiling against the absurd, NOT a calibrated budget**, and the
       * difference is the whole reason they can ship today. A calibrated budget needs the
       * measurements from SQEM-351, which do not exist yet — that ticket shipped the same day. A
       * ceiling needs only to know what cannot be legitimate: ten calls a second sustained across a
       * minute is not an agent working, it is a loop.
       *
       * ⚠️ **Tighten them once `mcp_call_peaks` holds real data.** They are env-configurable so that
       * needs no migration. Until then they are deliberately far too generous — MCP has no ceiling at
       * all today, and a very high one costs nobody who is working anything.
       *
       * ⭐ **Read and write are separate budgets.** An agent lists templates constantly; that is
       * normal, not abuse. It creates one rarely. A shared limit has to be set for the loud case and
       * is then useless for the expensive one — and writing is the half you do not get back.
       *
       * ⚠️ Fail-open, like everywhere: a limiter that locks people out when *it* is unhealthy is
       * worse than what it protects against. The SQEM-335 lesson is not the direction of that failure
       * but its visibility — answered by the self-test in this migration, which refuses to apply if
       * the function counts without limiting.
       */
      const kind  = counted === 'read' ? 'read' : 'write';
      const limit = kind === 'read' ? MCP_READ_RPM : MCP_WRITE_RPM;
      try {
        const { data: withinBudget, error: budgetErr } = await adminClient.rpc('check_mcp_rate_limit', {
          p_key_id: keyId, p_kind: kind, p_limit: limit,
        });
        if (budgetErr) {
          console.error('[mcp-rate] check failed, allowing request:', budgetErr.message);
        } else if (withinBudget === false) {
          // ⛔ A refusal is only useful if the client can act on it: the exhausted budget by name and
          // when it returns. A model can wait for that; on a generic error it can only give up or
          // hammer — and hammering is the behaviour the limit exists to stop.
          return rpcError(id, -32005,
            `Rate limit reached: more than ${limit} ${kind} calls in one minute on this connection. It resets within 60 seconds — retry then. The limit is per connection, so nobody else on the workspace is affected.`);
        }
      } catch (e) {
        console.error('[mcp-rate] check threw, allowing request:', (e as Error).message);
      }
    }
  }

  mark('gates');

  /**
   * ⛔ **The `else` branch that used to stand here is gone (SQEM-346).**
   *
   * It handled the connection with no user: SQEM-210 gave it only templates carrying no access rules
   * at all, because with nobody to evaluate a rule *for*, "restricted" could not be answered. That
   * branch was correct for as long as such a connection could exist. It no longer can — every key is
   * a person's — so the question has one answer instead of two.
   *
   * ⚠️ Worth keeping in mind if a service identity is ever introduced: it does **not** get to reuse
   * this path. The deleted branch was over-restrictive on purpose ("restricting too much is the
   * recoverable direction"), and anything replacing it needs that property, not just a set of ids.
   */

  /**
   * ⭐ **SQEM-373 — the access sets and the read handlers now live in `_shared/libraryQueries.ts`.**
   *
   * They were moved, not copied. Chat gained native tool calling over the same library, and a second
   * implementation of "which templates may this person see" would have been the fourth twin in this
   * repo — an access rule fixed on one surface and left standing on the other is a security bug that
   * reads like a feature gap.
   *
   * Nothing about the behaviour here changed: the reader runs the same two RPCs with the same
   * `mcpUserId`, and every handler below still answers exactly what it answered before.
   */
  const [lib, { data: memberRow }] = await Promise.all([libP, memberP]);
  mark('access');
  const canAccessTemplate = lib.canAccessTemplate;
  const canAccessPersona  = lib.canAccessPersona;

  // SQEM-336 — what role does this connection's user hold in the workspace?
  //
  // Resolved once per connection rather than per call: the role cannot change mid-request, and a
  // lookup inside each write handler would run for an answer that never differs. SQEM-336 was the
  // first time `mcp-server` read `workspace_members` at all.
  //
  // ⚠️ **A null role is a real state and it means "no longer a member".** Since SQEM-346 a key is
  // deleted when its owner leaves, so this should not occur — but a role read that returns nothing
  // must fail closed regardless, because the alternative is that leaving the workspace silently
  // upgrades somebody.
  // (Started above, next to the access sets — SQEM-481.)
  const mcpUserRole: string | null = (memberRow as { role?: string } | null)?.role ?? null;

  /**
   * SQEM-339 — may this user manage content that is not their own?
   *
   * **Admin and editor, not admin alone.** SQEM-336 started with admin, and SQEM-339 corrected it:
   * an Editor exists precisely to work on the workspace's shared templates, so a rule that let them
   * see a shared template and not maintain it would have broken the role's whole purpose. A Member
   * is the case the gate is actually for — they use the library, they do not curate it.
   */
  const mcpUserManagesContent = mcpUserRole === 'admin' || mcpUserRole === 'editor';

  /**
   * SQEM-336 → 341 → 346 — may this connection write at all?
   *
   * **Editor or admin. That is the whole rule now.**
   *
   * ⛔ The second line that stood here — *"connection with no user: yes, bounded by its narrow
   * sight"* — is gone with the workspace-wide key (SQEM-346, owner decision). It was the last place
   * where authority hung on a **secret** instead of on a **person**, and it was reachable by
   * accident: `user_id` carried `on delete set null`, so deleting a profile promoted that person's
   * read-only member key into this branch. Authority now hangs on a person without exception.
   *
   * **A member reads. That is the whole role.** Decided by the product owner on 2026-09-09, and it
   * is not a new rule — it is the one RLS has enforced since the beginning (`prompts_insert`,
   * `prompts_update` and `prompts_delete` all test `get_user_role(...) in ('admin','editor')`).
   * MCP simply never asked, because it runs as service role and RLS never sees it. The two channels
   * disagreeing was invisible until the permission matrix put them side by side (SQEM-341).
   *
   * ⛔ **Ownership used to be a third disjunct and was removed, which is the subtle half.** Once a
   * member cannot create, they can only *become* an owner one way: by having been an editor or
   * admin earlier. `createdBy === mcpUserId` therefore stopped being an "own work" clause and
   * became purely a **grandfathering clause for the demoted** — invisible and uncountable, since
   * nothing lists how many templates a downgraded colleague may still change. RLS never granted
   * that, so keeping it here would have meant the two channels still disagreed, just in a smaller
   * place.
   *
   * ⚠️ **`created_by` keeps both jobs it ever had** — it decides who *sees* a row (the creator
   * branch in `can_access_*`, the mechanism behind "Only me") and who *inherits* it when somebody
   * leaves (`reassign_orphaned_content()`, SQEM-344). It only loses the third job, which SQEM-339
   * gave it for one day. Custody is an **event**; authority is a standing property of the role.
   * Mixing them was the mistake.
   *
   * ⚠️ **The predicate is deliberately connection-scoped rather than row-scoped**, so there is no
   * per-row decision left to get wrong — and `create`, which has no row, can use the same one.
   */
  const mayWrite: boolean = mcpUserManagesContent;

  /** The same refusal everywhere, so a member never has to guess which tool is the fussy one. */
  const refuseWrite = (id: unknown, what: string) =>
    rpcError(id as never, -32602, writeRefusalMessage(what));

  // SQEM-373 — all four moved into the reader with their comments intact; see
  // `_shared/libraryQueries.ts`. `hiddenFromCaller` is a pure function and is imported directly.
  const routeVisibility = lib.routeVisibility;
  const loadPersona = lib.renderPersona;

  // 3. Route methods

  // ping, initialize and notifications/initialized are answered before the gates (SQEM-481).

  // ---- prompts/list ----

  if (method === 'prompts/list') {
    const { data: templates } = await adminClient
      .from('prompts')
      .select('id, title, description, variables, kind')
      .eq('workspace_id', workspaceId)
      // SQEM-110 kept a draft out of MCP. SQEM-210 retired that axis — `published` is true for
      // every workspace template now, so this is a no-op guard against a stray false row from an
      // older client, not the boundary. Visibility is the access filter below.
      .or('published.eq.true,kind.eq.skill')
      .order('title');

    const prompts = (templates || [])
      .filter((t: any) => canAccessTemplate(t.id)) // SQEM-142/210 — access-filtered (per user on OAuth, open-only on API keys)
      .map((t: any) => ({
        name: toSlug(t.title),
        description: `[${t.kind}] ${t.description || t.title}`,
        arguments: buildArguments(t.variables || []),
      }));

    // SQEM-324 — personas ride the same rail, because this is the rail a *person* picks from. The
    // tools below let the model load one mid-conversation; this is what puts "Sales" in the client's
    // picker before a word is typed. Same object, two ways in, one renderer.
    const { data: personaRows } = await adminClient
      .from('personas')
      .select('id, title, description')
      .eq('workspace_id', workspaceId)
      .order('title');

    // ⚠️ Slug collisions are possible — a template and a persona may share a title. `prompts/get`
    // resolves templates first, so an unqualified duplicate would make the persona unreachable
    // while still listing it. Suffixing only the loser keeps every ordinary name clean.
    const takenNames = new Set(prompts.map(p => p.name));
    const visiblePersonas = ((personaRows as any[] | null) || []).filter(p => canAccessPersona(p.id));
    const personaRoutes = await routeVisibility(visiblePersonas.map(p => p.id));
    for (const persona of visiblePersonas) {
      // SQEM-326 — every route belongs to a template this caller cannot open: offering the entry
      // would advertise knowledge that cannot arrive.
      if (hiddenFromCaller(personaRoutes.get(persona.id))) continue;
      const base = toSlug(persona.title);
      const name = takenNames.has(base) ? `${base}_persona` : base;
      takenNames.add(name);
      prompts.push({
        name,
        description: `[persona] ${persona.description || persona.title}`,
        arguments: [],
      });
    }

    return rpcResult(id, { prompts });
  }

  // ---- prompts/get ----

  if (method === 'prompts/get') {
    const name: string = params?.name;
    const args: Record<string, string> = params?.arguments || {};

    if (!name) return rpcError(id, -32602, 'Missing prompt name');

    const { data: templates } = await adminClient
      .from('prompts')
      .select('id, title, description, content, variables, context_file_ids, kind')
      .eq('workspace_id', workspaceId)
      .or('published.eq.true,kind.eq.skill'); // SQEM-110/210 — vestigial guard, see above

    const template = (templates || []).find((t: any) => toSlug(t.title) === name);

    // SQEM-324 — not a template? It may be a persona. Templates resolve first, which is what the
    // `_persona` suffix in prompts/list exists to work around; both spellings are accepted here so
    // a client that cached either name keeps working.
    if (!template || !canAccessTemplate(template.id)) {
      const bare = name.endsWith('_persona') ? name.slice(0, -'_persona'.length) : name;
      const { data: personaRows } = await adminClient
        .from('personas')
        .select('id, title, description, content')
        .eq('workspace_id', workspaceId);
      const persona = ((personaRows as any[] | null) || [])
        .find(p => toSlug(p.title) === bare || toSlug(p.title) === name);

      const personaVisible = persona
        ? !hiddenFromCaller((await routeVisibility([persona.id])).get(persona.id))
        : false;
      if (persona && canAccessPersona(persona.id) && personaVisible) {
        const { text } = await loadPersona(persona);
        return rpcResult(id, {
          description: `[persona] ${persona.description || persona.title}`,
          messages: [{ role: 'user', content: { type: 'text', text } }],
        });
      }
    }

    if (!template || !canAccessTemplate(template.id)) return rpcError(id, -32602, `Prompt not found: ${name}`); // SQEM-142

    const resolvedInputs: Record<string, string> = {};
    for (const v of (template.variables || [])) {
      if (v.type === 'file') continue;
      resolvedInputs[v.name] = args[v.name] ?? v.defaultValue ?? '';
    }

    const resolvedContext = await lib.resolveContextFiles(template.context_file_ids);
    const contextParts: string[] = renderContextBlocks(resolvedContext);

    const renderedContent = substituteVariables(template.content || '', resolvedInputs);

    const parts: string[] = [];
    if (contextParts.length > 0) parts.push(contextParts.join('\n\n'));
    if (renderedContent) parts.push(renderedContent);

    const text = parts.join('\n\n');
    // SQEM-390 — one shape for both kinds. An assistant used to be served from `system_instruction`
    // here; that column is unread since the kind went, and the migration moved its text into
    // `content`, so a former assistant renders exactly as it did.
    const messages: any[] = [{ role: 'user', content: { type: 'text', text } }];

    return rpcResult(id, {
      description: template.description || template.title,
      messages,
    });
  }

  // ---- resources/list ----

  if (method === 'resources/list') {
    const { data: files } = await adminClient
      .from('workspace_files')
      .select('id, name, mime_type')
      .eq('workspace_id', workspaceId)
      .order('name');

    // SQEM-291 — filtered, not just fetched. Listing a name is a disclosure of its own.
    const resources = (files || []).filter((f: any) => lib.canAccessFile(f.id)).map((f: any) => ({
      uri: `sqemes://files/${f.id}`,
      name: f.name,
      mimeType: f.mime_type,
    }));

    return rpcResult(id, { resources });
  }

  // ---- resources/read ----

  if (method === 'resources/read') {
    const uri: string = params?.uri;
    if (!uri) return rpcError(id, -32602, 'Missing URI');

    try {
      const file = await lib.readContextFile(uri);
      // Text content is returned inline; binaries (PDF/images) as base64.
      return rpcResult(id, {
        contents: [file.text != null
          ? { uri: file.uri, mimeType: file.mimeType, text: file.text }
          : { uri: file.uri, mimeType: file.mimeType, blob: file.base64 }],
      });
    } catch (err) {
      const failed = libraryError(id, err); // SQEM-561 — shared; re-throws anything but not-found/bad-request
      return failed.ok ? rpcResult(id, failed.result) : rpcError(id, failed.code, failed.message);
    }
  }

  // ---- tools/list ----

  if (method === 'tools/list') {
    const tools = LIBRARY_TOOL_DEFS;

    /**
     * Only advertise tools this connection can actually use — **scope AND role** (SQEM-064 → 349).
     *
     * ⛔ The role half was missing, and the symptom was reported from production: a member ticked
     * *Create* on their own key (SQEM-328 lets them mint one), `create_template` appeared in their
     * client, they used it, and `tools/call` refused them. **The refusal is correct; advertising it
     * was not.** A model cannot tell "you may not" from "this is broken", and neither can the person
     * watching it.
     *
     * ⚠️ **This is SQEM-332 turned around.** There a tool was neither offered nor guarded; here it is
     * offered *and* guarded. Both times the advertisement and the gate disagreed — and both times the
     * advertisement was the silent half.
     *
     * ⛔ **Fixed here rather than only in the settings dialog, because the dialog is not the
     * boundary.** Three cases a disabled checkbox never reaches: keys minted before the rule existed,
     * an editor's fully-scoped key that outlives their demotion, and a member updating their own key
     * row through PostgREST — which RLS permits, since the row is theirs.
     *
     * The scope still narrows and the role still grants (SQEM-341); a scope beyond the role is not
     * corrupt data, it is simply inert. This makes the tool list say so.
     */
    const visibleTools = tools.filter((t) => {
      const cap = TOOL_CAPABILITY[t.name];
      return scopes.includes(cap) && (cap === 'read' || mayWrite);
    });
    // SQEM-523 — title and hints derived from the capability that gates the tool (_shared/toolAnnotations.ts).
    return rpcResult(id, {
      tools: visibleTools.map((t) => ({ ...t, annotations: toolAnnotations(t.name, TOOL_CAPABILITY[t.name], t.title) })),
    });
  }

  // ---- tools/call ----

  if (method === 'tools/call') {
    const toolName: string = params?.name;
    const args = params?.arguments || {};

    if (!toolName) return rpcError(id, -32602, 'Missing tool name');
    // SQEM-530 — only a tool the server knows is named in the log; anything else stays out of it.
    if (TOOL_CAPABILITY[toolName]) {
      call.tool = toolName;
      const length = Number(req.headers.get('content-length'));
      logCall('start', toolName, { bytes: Number.isFinite(length) && length > 0 ? length : null });
    }

    // Capability gate (SQEM-064): reject tools the connection isn't scoped for.
    //
    // ⛔ **SQEM-332 — an unmapped tool is now REFUSED, not waved through.** The old guard read
    // `if (requiredCap && …)`, so a tool missing from `TOOL_CAPABILITY` had `undefined` here, the
    // condition was falsy, and the call proceeded **with no scope check at all**. That is the
    // dangerous half of the same omission that made the persona tools invisible in `tools/list`:
    // one direction hides a tool, the other unguards it, and only the first is noticeable.
    //
    // Failing closed costs nothing — a tool the map does not know is a tool nobody meant to expose.
    const requiredCap = TOOL_CAPABILITY[toolName];
    if (!requiredCap) {
      return rpcError(id, -32601, `Unknown tool: '${toolName}'.`);
    }
    if (!scopes.includes(requiredCap)) {
      return rpcError(id, -32002, `Insufficient scope: '${toolName}' requires the '${requiredCap}' permission, which this connection is not granted.`);
    }

    // SQEM-341 — a member may read the library, not change it. Enforced HERE rather than in each
    // handler, deliberately.
    //
    // ⛔ Six handlers create things and every one of them would have needed the same three lines.
    // That shape is exactly how SQEM-336 happened: `update_template` and `delete_template` were the
    // two nobody remembered. A rule that must be repeated per tool is a rule that will be missed by
    // the next tool — and the missing one is silent, because a skipped check looks like success.
    //
    // The capability table already says which tools write. Reusing it means a new tool is covered by
    // being *declared*, not by someone remembering to guard it.
    //
    // ⚠️ **The scope check above is not a substitute.** Scopes say what the connection was issued
    // for; this says what the person behind it may do. A member picks their own scopes when they
    // mint a key (SQEM-328, default `{read,create,update,delete}`), so the scope is theirs to grant
    // themselves — the role is not.
    if (requiredCap !== 'read' && !mayWrite) {
      return refuseWrite(id, `'${toolName}' (${requiredCap})`);
    }

    // SQEM-561 — the handlers live in `_shared/libraryActions.ts`, shared with sqemes Chat. The gates
    // above (unknown tool, scope, role) stay here: they are what MCP alone knows how to word.
    const outcome = await runLibraryTool(
      { adminClient, workspaceId, userId: mcpUserId, role: mcpUserRole, lib, surface: 'mcp' }, toolName, args);
    return outcome.ok ? rpcResult(id, outcome.result) : rpcError(id, outcome.code, outcome.message);
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}
