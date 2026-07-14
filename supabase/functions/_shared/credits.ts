// SQEM-082 phase 1 — credit accounting for Sqemes-funded (non-BYOK) AI calls.
//
// Funded calls (no user key — Sqemes routes through its own OpenRouter credential)
// debit the workspace's monthly AI-credit allowance. BYOK calls never call this.
// `credits_limit = 0` means unlimited (no metering). 1 credit = 1,000 tokens.

export interface CreditState {
  used: number;
  limit: number; // 0 = unlimited
}

/** Credits a token count costs (1 credit = 1,000 tokens, rounded up). */
export function creditsForTokens(tokens: number): number {
  return Math.max(0, Math.ceil((tokens || 0) / 1000));
}

/** Whether the workspace still has funded credits this period. */
export function hasCredits(state: CreditState): boolean {
  return state.limit === 0 || state.used < state.limit;
}

/** Reset the monthly allowance if a full period elapsed, then return the current state. */
// deno-lint-ignore no-explicit-any
export async function ensureCreditPeriod(admin: any, workspaceId: string): Promise<CreditState> {
  await admin.rpc('ensure_credit_period', { ws_id: workspaceId });
  const { data } = await admin
    .from('workspaces')
    .select('credits_used, credits_limit')
    .eq('id', workspaceId)
    .single();
  return { used: data?.credits_used ?? 0, limit: data?.credits_limit ?? 0 };
}

/** Debit credits for a completed funded call. No-op on unlimited tiers (limit 0). */
// deno-lint-ignore no-explicit-any
export async function debitCredits(admin: any, workspaceId: string, tokens: number, limit: number): Promise<void> {
  if (limit === 0) return;
  const amount = creditsForTokens(tokens);
  if (amount > 0) await admin.rpc('increment_credits', { ws_id: workspaceId, amount });
}
