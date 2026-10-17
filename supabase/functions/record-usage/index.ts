// SQEM-517 — the browser extension reports that a playbook was inserted. Counted per workspace, day,
// channel and playbook — never per person.
//
// Body: { workspaceId, channel: 'extension', action: 'playbook_inserted', templateId }
// Answers 204 whatever happens after the checks that decide WHETHER to count: a counter is never a
// reason for the extension to show an error, and it never waits for the write (EdgeRuntime.waitUntil).
//
// ⛔ Only the extension's own event can be reported. MCP and chat are counted by the server where the
// playbook is loaded, so a client cannot inflate them. Access is checked with the CALLER's token: a
// playbook the caller may not see is not found and not counted. A per-person budget (one-minute
// bucket, the same limiter as chat) keeps a script from inflating the numbers.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { uuidFromSeed } from '../_shared/chatBudget.ts';
import { countUsage, isClientReportable } from '../_shared/usageCounts.ts';

const USAGE_RPM_PER_USER = Number(Deno.env.get('USAGE_RPM_PER_USER') ?? '60');

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const done = (status = 204) => new Response(null, { status, headers: cors });

  try {
    if (req.method !== 'POST') return done(405);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return done(401);
    const admin = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return done(401);

    const body = await req.json().catch(() => ({}));
    const ws = String(body?.workspaceId ?? '');
    const templateId = String(body?.templateId ?? '');
    if (!ws || !templateId || !isClientReportable(body?.channel, body?.action)) return done(400);

    // Budget per person: over it, the event is simply not counted.
    const withinBudget = await checkRateLimit(await uuidFromSeed(`usage:${ws}:${user.id}`), USAGE_RPM_PER_USER);
    if (!withinBudget) return done();

    // The caller must be able to see the playbook in that workspace (RLS decides).
    const asUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: tpl } = await asUser.from('prompts').select('id').eq('id', templateId).eq('workspace_id', ws).maybeSingle();
    if (!tpl) return done();

    countUsage(admin, ws, 'extension', 'playbook_inserted', templateId);
    return done();
  } catch (e) {
    console.error('[record-usage]', (e as Error).message);
    return done();
  }
});
