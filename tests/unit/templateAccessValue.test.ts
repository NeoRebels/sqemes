import { describe, it, expect } from 'vitest';
import {
  accessToValue,
  accessValueToAccess,
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

  it('treats an editors-only rule as private, not as everyone', () => {
    // The trap: dropping the editor row without honouring hasRules would read this as "everyone"
    // and the next save would open a template only editors and admins could see.
    expect(accessToValue(['editor'], [], true, TEAM)).toEqual({ mode: 'private', userIds: [] });
  });

  it('falls back to private when a member row covers nobody (all members have left)', () => {
    expect(accessToValue(['member'], [], true, [user('admin-1', 'admin')]))
      .toEqual({ mode: 'private', userIds: [] });
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

  it('writes restricted-with-nobody the same way as private — they are the same state', () => {
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
