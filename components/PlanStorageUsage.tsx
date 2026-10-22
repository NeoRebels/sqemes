import { useEffect, useState } from 'react';
import UsageBar, { formatStorage } from './ui/UsageBar';
import { getWorkspaceStorageUsage } from '../lib/api/files';
import { IS_SELF_HOSTED } from '../lib/env';

/**
 * SQEM-556 — the storage bar on the current plan's card (Settings → Plans & Billing). Fetches its own
 * number so the card stays a plain render of `PLANS`; renders nothing on self-host, while loading, or
 * when the read fails — a missing bar is better than a wrong one.
 */
export default function PlanStorageUsage({ workspaceId }: { workspaceId: string }) {
  const [usage, setUsage] = useState<{ used: number; limit: number | null } | null>(null);
  useEffect(() => {
    if (IS_SELF_HOSTED || !workspaceId) return;
    let cancelled = false;
    getWorkspaceStorageUsage(workspaceId).then(u => { if (!cancelled) setUsage(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);
  if (!usage) return null;
  return <UsageBar label="Storage used" used={usage.used} limit={usage.limit} format={formatStorage} />;
}
