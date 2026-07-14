import { createAdminClient } from './supabase-admin.ts';

const RATE_LIMIT_RPM = parseInt(Deno.env.get('RATE_LIMIT_RPM') || '60', 10);

export async function checkRateLimit(workspaceId: string): Promise<boolean> {
  const adminClient = createAdminClient();
  const window = Math.floor(Date.now() / 60_000); // 1-minute bucket

  const { data, error } = await adminClient.rpc('check_and_increment_rate_limit', {
    ws_id: workspaceId,
    window_key: window,
    rate_limit: RATE_LIMIT_RPM,
  });

  if (error) {
    // Fail open — don't block users if rate limiting is unavailable
    console.error('Rate limit check failed:', error.message);
    return true;
  }

  return data === true;
}
