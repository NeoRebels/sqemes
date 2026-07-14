import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { encryptApiKey } from '../_shared/crypto.ts';

const MASKED_KEY_RE = /(?:\u2022){4,}|^\*{4,}$/;

function isPlaceholderKey(value: string) {
  return MASKED_KEY_RE.test(value) || /enter new key to replace/i.test(value);
}

function isHeaderSafeAscii(value: string) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Verify caller auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Use admin client (service role key) for auth verification — the
    // publishable key format isn't accepted as apikey by the Auth API.
    const adminClient = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { workspaceId, provider, key, action } = body;

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'Missing workspaceId' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Verify user is admin or editor in this workspace
    const { data: membership } = await adminClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // GET: Return which providers have keys configured (boolean map)
    // All workspace members (including 'member' role) can read key status
    if (!provider && !key && !action) {
      const { data: rows } = await adminClient
        .from('workspace_api_keys')
        .select('provider')
        .eq('workspace_id', workspaceId);

      const keys: Record<string, boolean> = {};
      for (const row of (rows || [])) {
        keys[row.provider] = true;
      }

      // SQEM-082 — whether Sqemes-funded AI (keyless, credit-metered) is available here.
      // Cloud sets MISTRAL_API_KEY; self-host leaves it unset → BYOK-only.
      const fundedAvailable = !!Deno.env.get('MISTRAL_API_KEY');

      return new Response(JSON.stringify({ keys, fundedAvailable }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Write operations require admin or editor role
    if (membership.role === 'member') {
      return new Response(JSON.stringify({ error: 'Insufficient permissions. Admin or Editor required.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // DELETE: Remove a key
    if (action === 'delete' && provider) {
      await adminClient
        .from('workspace_api_keys')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('provider', provider);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // POST: Upsert a key
    if (provider && key !== undefined) {
      if (typeof key !== 'string') {
        return new Response(JSON.stringify({ error: 'Invalid API key format' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const normalizedKey = key.trim();
      if (!normalizedKey || isPlaceholderKey(normalizedKey) || !isHeaderSafeAscii(normalizedKey)) {
        return new Response(JSON.stringify({ error: 'Invalid API key format. Paste the original provider key.' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const encryptedKey = await encryptApiKey(normalizedKey);

      const { error: upsertError } = await adminClient
        .from('workspace_api_keys')
        .upsert(
          {
            workspace_id: workspaceId,
            provider,
            encrypted_key: encryptedKey,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,provider' }
        );

      if (upsertError) throw upsertError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    // Surface missing encryption key as a clear configuration error
    const status = message.includes('API_KEY_ENCRYPTION_KEY') ? 503 : 500;
    const body = status === 503
      ? { error: 'Server encryption key not configured. Contact your administrator.' }
      : { error: message };
    console.error('manage-api-keys error:', message);
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
