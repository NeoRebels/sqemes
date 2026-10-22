import { supabase } from '../supabase';
import { parseUsageSummary, USAGE_DAYS, type ChannelUsage, type UsageChannel } from '../usageSummary';

/**
 * SQEM-553 — per-channel usage of the last USAGE_DAYS UTC days for the Overview. Admins and editors
 * of the workspace only; the database refuses everyone else (42501), so callers gate on `canManage`
 * and treat an error as "no numbers", never as zero.
 */
export async function fetchUsageSummary(workspaceId: string): Promise<Partial<Record<UsageChannel, ChannelUsage>>> {
  const { data, error } = await supabase.rpc('workspace_usage_summary', { p_workspace_id: workspaceId, p_days: USAGE_DAYS });
  if (error) throw error;
  return parseUsageSummary(data);
}
