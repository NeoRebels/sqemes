// SQEM-214 — an account deletion may not leave a workspace without an admin.
//
// This used to delete the user outright and the dialog simply *warned* that "any workspaces where
// you are the only admin will be left without an admin". That state is dead: nobody can manage
// members, nobody reaches the billing portal, and the subscription keeps running. It is now refused.
//
// Enforced here rather than in the client, because this is where the deletion actually happens —
// a client-side check protects the honest path and nothing else.

import { createAdminClient } from '../_shared/supabase-admin.ts';
import { cancelAndDeleteWorkspace, classifyWorkspacesOnDeparture } from '../_shared/workspaceDeletion.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { blocking, soleMember } = await classifyWorkspacesOnDeparture(adminClient, user.id);

    // Refuse before touching anything. The message names the workspaces and the way out — a bare
    // "not allowed" would leave the person guessing which of their workspaces is the problem.
    if (blocking.length > 0) {
      const names = blocking.map(w => `"${w.name}"`).join(', ');
      return new Response(JSON.stringify({
        error: `You are the only admin of ${names}. Make someone else an admin there first — deleting your account would leave ${
          blocking.length === 1 ? 'it' : 'them'
        } with nobody who can manage members or billing.`,
      }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Workspaces where this user is the only member go with them — nobody is stranded, and each may
    // carry a live subscription that has to be cancelled rather than orphaned (SQEM-213).
    for (const workspaceId of soleMember) {
      await cancelAndDeleteWorkspace(adminClient, workspaceId);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('delete-account error:', error?.message);
    return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
