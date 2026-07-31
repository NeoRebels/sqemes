import { describe, it, expect } from 'vitest';
import { checkContentViolation } from '../../lib/contentGuard';
import type { Workspace } from '../../types';

// SQEM-184 — the DLP guard (Cloud Content Governance). Only reads the four fields below.
function ws(over: Partial<Workspace>): Workspace {
  return { blacklistedTerms: [], blockEmails: false, blockIban: false, blockPhone: false, ...over } as unknown as Workspace;
}

describe('checkContentViolation', () => {
  it('returns null for clean text with everything off', () => {
    expect(checkContentViolation('a perfectly normal message', ws({}))).toBeNull();
  });

  it('matches a blacklisted term case-insensitively and names it', () => {
    const msg = checkContentViolation('This mentions ProjectFalcon somewhere', ws({ blacklistedTerms: ['projectfalcon'] }));
    expect(msg).toContain('projectfalcon');
  });

  it('blocks emails only when blockEmails is on', () => {
    expect(checkContentViolation('reach me at a@b.com', ws({ blockEmails: false }))).toBeNull();
    expect(checkContentViolation('reach me at a@b.com', ws({ blockEmails: true }))).toMatch(/email/i);
  });

  it('blocks IBANs only when blockIban is on', () => {
    const iban = 'DE89370400440532013000';
    expect(checkContentViolation(iban, ws({ blockIban: false }))).toBeNull();
    expect(checkContentViolation(iban, ws({ blockIban: true }))).toMatch(/iban/i);
  });

  it('blocks phone numbers only when blockPhone is on', () => {
    const phone = '+49 30 1234567';
    expect(checkContentViolation(phone, ws({ blockPhone: false }))).toBeNull();
    expect(checkContentViolation(phone, ws({ blockPhone: true }))).toMatch(/telephone|phone/i);
  });
});
