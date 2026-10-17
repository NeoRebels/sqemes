/**
 * SQEM-517 — count one use of a playbook, without ever slowing down or breaking the use itself.
 *
 * Counted per workspace, day, channel and playbook — never per person (a deliberate decision; a
 * per-employee view would usually need the works council in a German company). Fire-and-forget:
 * the write runs after the answer (`EdgeRuntime.waitUntil` where the runtime has it), and a failure
 * is logged, never thrown — a broken counter must not cost anybody their playbook.
 */
export type UsageChannel = 'extension' | 'mcp' | 'chat';
export type UsageAction = 'playbook_inserted' | 'playbook_loaded';

export const USAGE_CHANNELS: readonly UsageChannel[] = ['extension', 'mcp', 'chat'];
export const USAGE_ACTIONS: readonly UsageAction[] = ['playbook_inserted', 'playbook_loaded'];

/** What a CLIENT may report. MCP and chat are counted by the server itself and cannot be claimed. */
export function isClientReportable(channel: unknown, action: unknown): boolean {
  return channel === 'extension' && action === 'playbook_inserted';
}

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };

export function countUsage(admin: Rpc, ws: string, channel: UsageChannel, action: UsageAction, templateId: string): void {
  if (!ws || !templateId) return;
  const p = Promise.resolve(admin.rpc('bump_usage', { p_ws: ws, p_channel: channel, p_action: action, p_template: templateId }))
    .then(({ error }) => { if (error) console.error('[usage] count failed:', error.message); })
    .catch((e: Error) => console.error('[usage] count threw:', e?.message));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}
