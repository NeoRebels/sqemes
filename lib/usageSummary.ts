/**
 * SQEM-553 — the usage line on the Overview's channel cards. Pure, so it is tested directly.
 *
 * The numbers come from `workspace_usage_summary` (aggregates of usage_daily, never a person). Days
 * are UTC days, so the label says "last 7 days", never "this week". The most used playbook arrives as
 * an id; its title comes from the viewer's own playbook list, and a playbook the viewer cannot open is
 * left out rather than named (same rule as the chat chips, SQEM-551).
 */
import type { PromptKind } from '../types';
import { m } from './i18n';

export const USAGE_DAYS = 7;
export type UsageChannel = 'extension' | 'mcp' | 'chat';
export interface ChannelUsage { uses: number; topTemplateId: string | null; topUses: number }

/** Rows from the RPC → one entry per known channel. Bigints may arrive as strings; anything odd is dropped. */
export function parseUsageSummary(rows: unknown): Partial<Record<UsageChannel, ChannelUsage>> {
  const out: Partial<Record<UsageChannel, ChannelUsage>> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    const ch = row.channel;
    if (ch !== 'extension' && ch !== 'mcp' && ch !== 'chat') continue;
    const uses = Number(row.uses);
    const topUses = Number(row.top_uses);
    if (!Number.isFinite(uses) || uses < 0) continue;
    out[ch] = {
      uses,
      topTemplateId: typeof row.top_template_id === 'string' ? row.top_template_id : null,
      topUses: Number.isFinite(topUses) ? topUses : 0,
    };
  }
  return out;
}

export interface UsageLine {
  count: number;
  label: string;
  top: { id: string; title: string; uses: number } | null;
}

export function usageLine(
  usage: ChannelUsage | undefined,
  visible: ReadonlyMap<string, { title: string; kind: PromptKind }>,
  days = USAGE_DAYS,
): UsageLine {
  const count = usage?.uses ?? 0;
  if (count === 0) return { count, label: m.ov_usage_none({ days }), top: null };
  const p = usage?.topTemplateId ? visible.get(usage.topTemplateId) : undefined;
  return {
    count,
    label: m.ov_usage_label({ count, days }),
    top: p && usage?.topTemplateId ? { id: usage.topTemplateId, title: p.title, uses: usage.topUses } : null,
  };
}
