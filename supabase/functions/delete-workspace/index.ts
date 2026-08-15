// SQEM-213 — deleting a workspace cancels its subscription first.
//
// Until this existed, `deleteWorkspace` was a bare `supabase.from('workspaces').delete()` from the
// browser and **nothing anywhere cancelled the Stripe subscription**: `delete-account` does not
// touch Stripe, and the webhook only reacts to events Stripe already knows about. The row vanished,
// the card kept being charged, and the only way to stop it was the billing portal — which the
// customer had to find on their own, before deleting.
//
// The order below is the whole point. Cancel first, delete only if that succeeded: a failed
// cancellation leaves the workspace intact and tells the caller why, so "you cannot delete this
// until the subscription is gone" is the automatic fallback rather than a second code path.
//
// Deletion is deliberately no longer possible from the client (the `workspaces_delete` RLS policy
// is dropped in the accompanying migration). An action that moves money does not belong in the
// browser, where it can be issued without ever passing through here.

import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { cancelAndDeleteWorkspace } from '../_shared/workspaceDeletion.ts';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const adminClient = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { workspaceId } = await req.json();
    if (!workspaceId) return json({ error: 'Missing workspaceId' }, 400);

    // 1. Admin of THIS workspace, checked server-side — the client no longer has a delete path.
    const { data: membership } = await adminClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (!membership || membership.role !== 'admin') {
      return json({ error: 'Only workspace admins can delete a workspace.' }, 403);
    }

    // 2. + 3. Cancel, then delete — and only in that order. SQEM-214 moved this into
    //    `_shared/workspaceDeletion.ts` because account deletion needs exactly the same thing, and
    //    two cancellation paths eventually become one that cancels and one that forgets to.
    try {
      await cancelAndDeleteWorkspace(adminClient, workspaceId);
    } catch (e: any) {
      // A failed cancellation is not a server fault — it is the reason the workspace still exists.
      if (String(e.message).includes('could not be cancelled')) return json({ error: e.message }, 502);
      throw e;
    }

    return json({ success: true });
  } catch (error: any) {
    console.error('delete-workspace error:', error.message);
    return json({ error: error.message }, 500);
  }
});
