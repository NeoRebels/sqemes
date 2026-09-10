import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEY_SCOPE,
  clampScopeToAuthority,
  defaultScopeFor,
  scopeArrayFromValue,
} from '../../components/ApiKeyScopeFields';

/**
 * SQEM-353 — a member's connection must not be created carrying write scopes.
 *
 * ⛔ SQEM-349 disabled the checkboxes and left `DEFAULT_KEY_SCOPE` alone, and that default carries
 * `create: true, update: true`. **A disabled checkbox prevents the click, not the value** — so a
 * member opened the dialog with two boxes ticked, could not untick them, and their key was written
 * with `['read','create','update']`.
 *
 * ⚠️ Reported from production the same day SQEM-349 shipped. It is the second time in two days that
 * a hardcoded default was the real cause while attention sat on the mechanism beside it — SQEM-348
 * was the same shape, with a name instead of a scope.
 */
describe('scopes never exceed what the person may grant (SQEM-353)', () => {
  it('pins the default that caused this — it really does carry write', () => {
    // Guards the guard: if someone "fixes" this by changing the constant, the tests below would
    // start passing for the wrong reason and the clamp could be removed unnoticed.
    expect(DEFAULT_KEY_SCOPE.create).toBe(true);
    expect(DEFAULT_KEY_SCOPE.update).toBe(true);
  });

  it('starts a member read-only', () => {
    const d = defaultScopeFor(false);
    expect(d.create).toBe(false);
    expect(d.update).toBe(false);
    expect(d.delete).toBe(false);
    expect(scopeArrayFromValue(d)).toEqual(['read']);
  });

  it('leaves an editor or admin untouched', () => {
    expect(defaultScopeFor(true)).toEqual(DEFAULT_KEY_SCOPE);
  });

  it('strips write scopes on save even when the form somehow holds them', () => {
    // ⛔ The point of clamping at save as well as at start: the UI is never the boundary. A stale
    // state, a second entry point, or a future component that forgets the `canWrite` prop must not
    // be able to write a scope the person could not choose.
    const tampered = { ...DEFAULT_KEY_SCOPE, delete: true };
    expect(scopeArrayFromValue(clampScopeToAuthority(tampered, false))).toEqual(['read']);
    expect(scopeArrayFromValue(clampScopeToAuthority(tampered, true)))
      .toEqual(['read', 'create', 'update', 'delete']);
  });

  it('keeps the expiry choice, which is not a permission', () => {
    // ⚠️ Clamping is about authority, not about tidying the object. Lifetime is a separate decision
    // that a member is allowed to make about their own connection.
    const v = { ...DEFAULT_KEY_SCOPE, expiry: 'custom' as const, customDate: '2027-01-01' };
    const clamped = clampScopeToAuthority(v, false);
    expect(clamped.expiry).toBe('custom');
    expect(clamped.customDate).toBe('2027-01-01');
  });
});
