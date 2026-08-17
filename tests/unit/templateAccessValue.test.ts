import { describe, it, expect } from 'vitest';
import {
  accessToValue,
  accessValueToAccess,
  unrepresentableRoleGrants,
  workspaceDefaultToValue,
  valueToWorkspaceDefault,
  seedFromWorkspaceDefault,
} from '../../components/TemplateAccessControl';
import type { User } from '../../types';

// SQEM-210/211 — these functions carry the whole access semantics between the DB and the UI, and
// two of the three states arrive as identical empty lists. Getting them wrong does not throw; it
// silently opens a private template to the workspace or hides a shared one. Hence tests.

const user = (id: string, role: User['role']): User =>
  ({ id, name: id, email: `${id}@example.com`, avatar: '', role });

const TEAM: User[] = [
  user('admin-1', 'admin'),
  user('editor-1', 'editor'),
  user('member-1', 'member'),
  user('member-2', 'member'),
];

describe('accessToValue', () => {
  it('reads no rows as open to everyone', () => {
    expect(accessToValue([], [], false, TEAM)).toEqual({ mode: 'everyone', userIds: [] });
  });

  it('reads a row that names nobody as private — the opposite of no rows', () => {
    expect(accessToValue([], [], true, TEAM)).toEqual({ mode: 'private', userIds: [] });
  });

  it('reads named people as restricted', () => {
    expect(accessToValue([], ['member-1'], true, TEAM)).toEqual({
      mode: 'restricted', userIds: ['member-1'],
    });
  });

  it('resolves a legacy member-role row into the people it currently covers', () => {
    // Preserves exactly what the template does today, and makes the switch from a dynamic role
    // grant to a static list visible in the UI instead of hiding it.
    expect(accessToValue(['member'], [], true, TEAM)).toEqual({
      mode: 'restricted', userIds: ['member-1', 'member-2'],
    });
  });

  it('does not resolve admins or editors into the list — they are granted anyway', () => {
    const v = accessToValue(['member'], [], true, TEAM);
    expect(v.userIds).not.toContain('admin-1');
    expect(v.userIds).not.toContain('editor-1');
  });

  it('merges a role row with individual grants without duplicating anyone', () => {
    expect(accessToValue(['member'], ['member-1'], true, TEAM)).toEqual({
      mode: 'restricted', userIds: ['member-1', 'member-2'],
    });
  });

  // SQEM-238 — these two used to expect `private`, and that expectation was the bug written down.
  // A rule granting editors is not "Only me"; displaying it that way told the owner their template
  // was seen by nobody while every editor could open it. Measured on production 2026-08-17.
  it('reads an editors-only rule as restricted — never as private, never as everyone', () => {
    // Both old answers were wrong in opposite directions: `everyone` would have opened it to
    // members on the next save, `private` claimed a promise that was not being kept.
    expect(accessToValue(['editor'], [], true, TEAM)).toEqual({ mode: 'restricted', userIds: [] });
  });

  it('reads a member row that covers nobody as restricted (all members have left)', () => {
    // The rule still exists and still says "members"; the workspace simply has none right now.
    // Calling that "Only me" would promise exclusivity that the next joiner silently breaks.
    expect(accessToValue(['member'], [], true, [user('admin-1', 'admin')]))
      .toEqual({ mode: 'restricted', userIds: [] });
  });

  it('still reads the principal-less row as private — that one really is only me', () => {
    expect(accessToValue([], [], true, TEAM)).toEqual({ mode: 'private', userIds: [] });
  });
});

describe('unrepresentableRoleGrants', () => {
  // SQEM-238 — what the access list cannot show, so the editor can warn instead of quietly
  // replacing it on save.
  it('reports editor and admin grants', () => {
    expect(unrepresentableRoleGrants(['editor'])).toEqual(['editor']);
    expect(unrepresentableRoleGrants(['admin', 'editor'])).toEqual(['admin', 'editor']);
  });

  it('does not report member grants — those resolve into named people', () => {
    expect(unrepresentableRoleGrants(['member'])).toEqual([]);
  });

  it('reports nothing when there are no role rows', () => {
    expect(unrepresentableRoleGrants([])).toEqual([]);
  });
});

describe('accessValueToAccess', () => {
  it('writes everyone as no rules', () => {
    expect(accessValueToAccess({ mode: 'everyone', userIds: ['member-1'] }))
      .toEqual({ roles: [], userIds: [], hasRules: false });
  });

  it('writes private as a rule with no principals', () => {
    expect(accessValueToAccess({ mode: 'private', userIds: [] }))
      .toEqual({ roles: [], userIds: [], hasRules: true });
  });

  it('never writes a role row', () => {
    expect(accessValueToAccess({ mode: 'restricted', userIds: ['member-1'] }))
      .toEqual({ roles: [], userIds: ['member-1'], hasRules: true });
  });

  it('writes restricted-with-nobody the same way as private — one row, one meaning', () => {
    // Deliberate and unchanged by SQEM-238: there is exactly one way to store "restricted, nobody
    // named", and since SQEM-212 that row means the creator alone. The control therefore stops
    // promising admins & editors access once the list is empty — see the footer. Giving the two
    // states separate encodings would need a second row shape and is a model change, not a fix.
    expect(accessValueToAccess({ mode: 'restricted', userIds: [] }))
      .toEqual(accessValueToAccess({ mode: 'private', userIds: [] }));
  });
});

describe('round trip', () => {
  it('survives everyone → write → read', () => {
    const w = accessValueToAccess({ mode: 'everyone', userIds: [] });
    expect(accessToValue(w.roles, w.userIds, w.hasRules, TEAM).mode).toBe('everyone');
  });

  it('survives private → write → read', () => {
    const w = accessValueToAccess({ mode: 'private', userIds: [] });
    expect(accessToValue(w.roles, w.userIds, w.hasRules, TEAM).mode).toBe('private');
  });

  it('survives restricted → write → read, keeping the same people', () => {
    const w = accessValueToAccess({ mode: 'restricted', userIds: ['member-2'] });
    expect(accessToValue(w.roles, w.userIds, w.hasRules, TEAM))
      .toEqual({ mode: 'restricted', userIds: ['member-2'] });
  });

  it('makes a resolved legacy row static once saved', () => {
    // Before the save the DB row is dynamic; after it, the people are named. A member who joins
    // afterwards is deliberately not covered — that is the trade the control warns about.
    const resolved = accessToValue(['member'], [], true, TEAM);
    const w = accessValueToAccess(resolved);
    expect(w.roles).toEqual([]);
    expect(w.userIds).toEqual(['member-1', 'member-2']);
  });
});

describe('workspace default (two states)', () => {
  it('reads an empty default as everyone', () => {
    expect(workspaceDefaultToValue([])).toEqual({ mode: 'everyone', userIds: [] });
  });

  it('reads any stored role as "restricted by default" — the array is a marker, not a grantee list', () => {
    expect(workspaceDefaultToValue(['member'])).toEqual({ mode: 'restricted', userIds: [] });
    expect(workspaceDefaultToValue(['editor'])).toEqual({ mode: 'restricted', userIds: [] });
  });

  it('persists the two states as empty / non-empty', () => {
    expect(valueToWorkspaceDefault({ mode: 'everyone', userIds: [] })).toEqual([]);
    expect(valueToWorkspaceDefault({ mode: 'restricted', userIds: [] })).toEqual(['member']);
  });

  it('seeds a new template as Only me when the workspace restricts by default', () => {
    expect(seedFromWorkspaceDefault(['member'])).toEqual({ mode: 'private', userIds: [] });
  });

  it('seeds a new template as everyone when the workspace does not', () => {
    expect(seedFromWorkspaceDefault([])).toEqual({ mode: 'everyone', userIds: [] });
  });
});
