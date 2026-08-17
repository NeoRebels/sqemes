import { describe, it, expect } from 'vitest';
import { mcpKeyExpiry, isMcpKeyExpired, countActiveMcpKeys } from '../../lib/mcpKeys';
import type { McpKeyLifetime } from '../../lib/mcpKeys';

// SQEM-226 — the expiry rule the Dashboard and Settings must agree on. The OAuth branch is the
// reason this is tested at all: reading `expires_at` on an OAuth row reports a live connection as
// expired, because that column holds the short access-token TTL, not the connection's lifetime.

const NOW = new Date('2026-08-17T12:00:00Z').getTime();
const past = '2026-08-17T11:00:00Z';
const future = '2026-08-18T12:00:00Z';

function key(over: Partial<McpKeyLifetime>): McpKeyLifetime {
  return { is_oauth: false, expires_at: null, connection_expires_at: null, ...over };
}

describe('mcpKeyExpiry', () => {
  it('reads expires_at for a plain key', () => {
    expect(mcpKeyExpiry(key({ expires_at: future }))).toBe(future);
  });

  it('reads connection_expires_at for an OAuth key, NOT the access-token TTL', () => {
    const oauth = key({ is_oauth: true, expires_at: past, connection_expires_at: future });
    expect(mcpKeyExpiry(oauth)).toBe(future);
  });

  it('is null when nothing expires', () => {
    expect(mcpKeyExpiry(key({}))).toBeNull();
  });
});

describe('isMcpKeyExpired', () => {
  it('treats a key without an expiry as never expiring', () => {
    expect(isMcpKeyExpired(key({}), NOW)).toBe(false);
  });

  it('is expired once the timestamp has passed', () => {
    expect(isMcpKeyExpired(key({ expires_at: past }), NOW)).toBe(true);
  });

  it('is not expired while the timestamp is ahead', () => {
    expect(isMcpKeyExpired(key({ expires_at: future }), NOW)).toBe(false);
  });

  it('expires exactly at the boundary, not a moment later', () => {
    const boundary = new Date(NOW).toISOString();
    expect(isMcpKeyExpired(key({ expires_at: boundary }), NOW)).toBe(true);
  });

  // The regression this file exists for: an OAuth connection whose access token expired an hour ago
  // is still a live connection. Counting it as expired would tell a user their MCP setup is gone.
  it('keeps an OAuth key alive when only its access token has expired', () => {
    const oauth = key({ is_oauth: true, expires_at: past, connection_expires_at: future });
    expect(isMcpKeyExpired(oauth, NOW)).toBe(false);
  });

  it('expires an OAuth key when the connection itself has run out', () => {
    const oauth = key({ is_oauth: true, expires_at: future, connection_expires_at: past });
    expect(isMcpKeyExpired(oauth, NOW)).toBe(true);
  });
});

describe('countActiveMcpKeys', () => {
  it('counts only what is still usable', () => {
    const keys = [
      key({}),                                                          // never expires
      key({ expires_at: future }),                                      // still valid
      key({ expires_at: past }),                                        // expired
      key({ is_oauth: true, expires_at: past, connection_expires_at: future }), // live OAuth
      key({ is_oauth: true, connection_expires_at: past }),             // dead OAuth
    ];
    expect(countActiveMcpKeys(keys, NOW)).toBe(3);
  });

  it('is zero for an empty list', () => {
    expect(countActiveMcpKeys([], NOW)).toBe(0);
  });
});
