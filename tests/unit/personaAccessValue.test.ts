import { describe, it, expect } from 'vitest';
// ⚠️ Imported from `lib/personaAccessValue`, NOT from `lib/api/personaAccess`: the latter imports
// the Supabase client, which throws at import time without env vars — green locally, red in CI.
import {
  accessValueToPersonaAccess,
  personaAccessToValue,
  type PersonaAccess,
} from '../../lib/personaAccessValue';
import type { TemplateAccessValue } from '../../components/TemplateAccessControl';

// SQEM-326 — the same reason the template twin has tests, and the same trap: **two of the three
// states arrive as identical empty lists.** "Everyone" and "only me" differ by `hasRules` alone, so
// a mistake here does not throw — it silently opens a private persona to the workspace, or hides a
// shared one from the team that was using it.

describe('accessValueToPersonaAccess', () => {
  it('writes no rules for "everyone"', () => {
    expect(accessValueToPersonaAccess({ mode: 'everyone', userIds: [], groupIds: [] }))
      .toEqual({ userIds: [], groupIds: [], hasRules: false });
  });

  it('writes a rule naming nobody for "only me"', () => {
    expect(accessValueToPersonaAccess({ mode: 'private', userIds: [], groupIds: [] }))
      .toEqual({ userIds: [], groupIds: [], hasRules: true });
  });

  it('writes the named people and groups for "restricted"', () => {
    expect(accessValueToPersonaAccess({ mode: 'restricted', userIds: ['u1', 'u2'], groupIds: ['g1'] }))
      .toEqual({ userIds: ['u1', 'u2'], groupIds: ['g1'], hasRules: true });
  });

  // SQEM-300 on templates: `can_access_persona()` tests `created_by = auth.uid()` first and
  // unconditionally, so a row for the owner grants nothing — and a row that grants nothing is one
  // somebody later tries to reason about.
  it('never writes a row for the owner', () => {
    expect(accessValueToPersonaAccess({ mode: 'restricted', userIds: ['owner', 'u1'], groupIds: [] }, 'owner'))
      .toEqual({ userIds: ['u1'], groupIds: [], hasRules: true });
  });

  it('strips nobody when there is no owner recorded', () => {
    // With no creator, nobody holds implicit access, so every name is doing real work.
    expect(accessValueToPersonaAccess({ mode: 'restricted', userIds: ['u1'], groupIds: [] }, null))
      .toEqual({ userIds: ['u1'], groupIds: [], hasRules: true });
  });

  // "Restricted with nobody ticked" is the same promise as "only me", and writes the same row.
  it('treats restricted-with-nobody as the private row', () => {
    const v = accessValueToPersonaAccess({ mode: 'restricted', userIds: [], groupIds: [] });
    expect(v.hasRules).toBe(true);
    expect(v.userIds).toEqual([]);
    expect(v.groupIds).toEqual([]);
  });
});

describe('personaAccessToValue', () => {
  const rows = (a: Partial<PersonaAccess>): PersonaAccess =>
    ({ userIds: [], groupIds: [], hasRules: false, ...a });

  it('reads no rows as everyone', () => {
    expect(personaAccessToValue(rows({})))
      .toEqual({ mode: 'everyone', userIds: [], groupIds: [] });
  });

  it('reads a principal-less row as only me', () => {
    expect(personaAccessToValue(rows({ hasRules: true })))
      .toEqual({ mode: 'private', userIds: [], groupIds: [] });
  });

  it('reads named principals as restricted', () => {
    expect(personaAccessToValue(rows({ hasRules: true, userIds: ['u1'], groupIds: ['g1'] })))
      .toEqual({ mode: 'restricted', userIds: ['u1'], groupIds: ['g1'] });
  });

  it('reads a group row alone as restricted, not as only me', () => {
    // A persona reachable by a whole group is not "the creator alone" — describing it that way is
    // the lie SQEM-238 fixed on templates.
    expect(personaAccessToValue(rows({ hasRules: true, groupIds: ['g1'] })).mode).toBe('restricted');
  });
});

describe('round trip', () => {
  // The states have to survive a save/load cycle unchanged — that cycle is what the editor does on
  // every visit, and a drift there changes access without anybody asking for it.
  const cases: TemplateAccessValue[] = [
    { mode: 'everyone', userIds: [], groupIds: [] },
    { mode: 'private', userIds: [], groupIds: [] },
    { mode: 'restricted', userIds: ['u1', 'u2'], groupIds: ['g1'] },
  ];
  it.each(cases)('preserves $mode', value => {
    expect(personaAccessToValue(accessValueToPersonaAccess(value))).toEqual(value);
  });
});
