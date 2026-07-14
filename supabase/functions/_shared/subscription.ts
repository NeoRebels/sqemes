// SQEM-083 — server-side paywall. A non-managed workspace with no active/trialing
// subscription can't use the product server-side either (covers MCP + edge functions,
// BYOK included), so the UI gate can't be bypassed. Managed workspaces are exempt;
// self-host (open core) bypasses entirely via the SELF_HOSTED flag (no subscription model).
// deno-lint-ignore no-explicit-any
export async function isWorkspaceSubscriptionActive(admin: any, workspaceId: string): Promise<boolean> {
  if (Deno.env.get('SELF_HOSTED') === 'true') return true;
  const { data } = await admin
    .from('workspaces')
    .select('is_managed, subscription_status')
    .eq('id', workspaceId)
    .single();
  if (!data) return false;
  return !!data.is_managed
    || data.subscription_status === 'active'
    || data.subscription_status === 'trialing';
}
