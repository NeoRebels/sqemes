/**
 * SQEM-536 — what Chat says when the workspace has no model to talk to.
 *
 * ⛔ Two audiences, two answers. A provider key is a workspace-wide credential and stays closed to
 * members (SQEM-328, `api-keys:manage`), so sending a member to Settings → API & MCP sends them to
 * a card they cannot see. Before this ticket the empty state also named a place that no longer
 * existed ("Settings › LLM API Keys" — renamed "AI provider keys" by SQEM-287).
 *
 * Pure on purpose: `pages/Chat.tsx` is too large to render in a unit test, and the wording is the
 * thing that drifted.
 */
export interface NoKeyHint {
  text: string;
  /** Only for someone who can add a key; `null` means no button. */
  actionLabel: string | null;
}

export function noKeyHint(canManageKeys: boolean): NoKeyHint {
  return canManageKeys
    ? { text: 'No AI provider key yet. Add one to start chatting.', actionLabel: 'Add an AI provider key' }
    : { text: 'No AI provider key yet. Ask a workspace admin or editor to add one.', actionLabel: null };
}

/** Where the button goes: the tab that holds "AI provider keys". */
export const PROVIDER_KEYS_TAB = 'api' as const;
