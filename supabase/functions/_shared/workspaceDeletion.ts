// SQEM-214 — one place that ends a workspace, because two would eventually disagree about money.
//
// Extracted from `delete-workspace` (SQEM-213) when account deletion needed the same thing: a user
// who is the sole member of a workspace takes it with them, and that workspace may carry a live
// subscription. Duplicating the Stripe call into `delete-account` would have meant two cancellation
// paths — and the one nobody looks at is the one that quietly stops cancelling.

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

/**
 * Cancels the workspace's subscription (immediately), then deletes the row — and **only** in that
 * order. Throws if the cancellation fails, which leaves the workspace standing: a workspace that
 * still exists is recoverable, a subscription that keeps billing for a deleted one is not.
 *
 * `resource_missing` is treated as already cancelled: Stripe has nothing to cancel, so there is
 * nothing to block on. ⚠️ A `STRIPE_SECRET_KEY` from the *wrong account* produces the same answer,
 * and looks exactly like success — so a key swap must be verified against a subscription known to
 * exist, not against a deletion appearing to work.
 *
 * No subscription at all (self-host, never subscribed) skips Stripe entirely.
 */
export async function cancelAndDeleteWorkspace(
  adminClient: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  workspaceId: string,
): Promise<void> {
  const { data: ws } = await adminClient
    .from('workspaces')
    .select('stripe_subscription_id')
    .eq('id', workspaceId)
    .single();

  if (ws?.stripe_subscription_id && STRIPE_SECRET_KEY) {
    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(ws.stripe_subscription_id)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
    );
    const body = await res.json().catch(() => ({}));
    const alreadyGone = res.status === 404 || body?.error?.code === 'resource_missing';
    if (!res.ok && !alreadyGone) {
      throw new Error(
        `The subscription could not be cancelled, so the workspace was not deleted: ${
          body?.error?.message ?? `Stripe returned ${res.status}`
        }`,
      );
    }
  }

  const { error } = await adminClient.from('workspaces').delete().eq('id', workspaceId);
  if (error) throw error;
}

/**
 * Workspaces this user would strand: they are the only admin **and** somebody else is still there.
 * Those block the action (SQEM-214) — silently promoting a member would hand them billing and every
 * template without being asked, which is worse than a refusal that names the way out.
 *
 * Returns the workspaces to complain about and, separately, the ones the user is alone in — the
 * latter are deleted rather than stranded, since nobody is left to strand.
 */
export async function classifyWorkspacesOnDeparture(
  adminClient: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
): Promise<{ blocking: { id: string; name: string }[]; soleMember: string[] }> {
  const { data: mine } = await adminClient
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId);

  const blocking: { id: string; name: string }[] = [];
  const soleMember: string[] = [];

  for (const row of (mine ?? []) as { workspace_id: string; role: string }[]) {
    const { data: members } = await adminClient
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', row.workspace_id);

    const all = (members ?? []) as { user_id: string; role: string }[];
    if (all.length <= 1) {
      soleMember.push(row.workspace_id);
      continue;
    }
    // Only admins matter here; an editor or member leaving strands nobody.
    const admins = all.filter(m => m.role === 'admin');
    if (row.role === 'admin' && admins.length === 1) {
      const { data: ws } = await adminClient
        .from('workspaces')
        .select('name')
        .eq('id', row.workspace_id)
        .single();
      blocking.push({ id: row.workspace_id, name: ws?.name ?? 'a workspace' });
    }
  }

  return { blocking, soleMember };
}
