import { describe, it, expect } from 'vitest';
import { brandIsComplete, missingBrandFields } from '../../lib/brand';

const full = { brandName: 'Acme', whatItDoes: 'Ships things', audience: 'Ops teams' };

// SQEM-308 — one predicate, because there were three and they disagreed.
describe('brandIsComplete', () => {
  it('accepts the three required fields', () => {
    expect(brandIsComplete(full)).toBe(true);
  });

  // ⛔ The behaviour this changes. "Adapt to brand" used to accept a name alone, which generates
  // something that sounds like the brand and knows nothing about it.
  it.each(['brandName', 'whatItDoes', 'audience'] as const)('rejects a missing %s', field => {
    expect(brandIsComplete({ ...full, [field]: '' })).toBe(false);
  });

  it('treats whitespace as empty — a space is not an answer', () => {
    expect(brandIsComplete({ ...full, audience: '   ' })).toBe(false);
  });

  // The optional fields are optional. Requiring them would block people for no gain.
  it('does not require useCase or website', () => {
    expect(brandIsComplete({ ...full, useCase: '', website: '' })).toBe(true);
  });

  it.each([[null], [undefined], [{}]])('rejects %s', brand => {
    expect(brandIsComplete(brand as never)).toBe(false);
  });
});

// A message that says "incomplete" sends someone hunting. Naming the fields is the difference
// between a next step and a dead end (SQEM-287).
describe('missingBrandFields', () => {
  it('names what is missing, in form order', () => {
    expect(missingBrandFields({ brandName: 'Acme' })).toEqual(['what it does', 'audience']);
  });
  it('is empty when nothing is missing', () => {
    expect(missingBrandFields(full)).toEqual([]);
  });
});
