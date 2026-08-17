// SQEM-226 — whether a Sqemes API / MCP key still counts as usable.
//
// The rule lived inline in Settings only. The Dashboard now needs the same answer, and two copies of
// an expiry rule drift: one surface would keep calling a key active after the other stopped. So it
// lives here once, and both read it.
//
// The conditional is the part worth stating: an OAuth connection's lifetime is
// `connection_expires_at` — `expires_at` on those rows is the short access-token TTL that the refresh
// flow rotates, so reading it would report a live connection as expired within the hour.

export interface McpKeyLifetime {
  is_oauth: boolean;
  expires_at: string | null;
  connection_expires_at: string | null;
}

/** The timestamp a user is shown for this key, or null when it never expires. */
export function mcpKeyExpiry(key: McpKeyLifetime): string | null {
  return key.is_oauth ? key.connection_expires_at : key.expires_at;
}

/** True once the key can no longer be used. A key without an expiry never expires. */
export function isMcpKeyExpired(key: McpKeyLifetime, now: number = Date.now()): boolean {
  const expiry = mcpKeyExpiry(key);
  return !!expiry && new Date(expiry).getTime() <= now;
}

/** How many of these keys are still usable — what the Dashboard reports as "active". */
export function countActiveMcpKeys(keys: McpKeyLifetime[], now: number = Date.now()): number {
  return keys.filter(k => !isMcpKeyExpired(k, now)).length;
}
