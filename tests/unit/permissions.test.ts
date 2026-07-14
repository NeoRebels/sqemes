import { describe, it, expect } from 'vitest';
import { can } from '../../lib/permissions';
import type { User, Workspace } from '../../types';

const makeUser = (role: User['role']): User => ({
  id: 'u1', name: 'Test', email: 'test@test.com', avatar: '', role,
});

const makeWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'ws1', name: 'WS', plan: 'Team', isManaged: false,
  creditsUsed: 0, creditsLimit: 0, apiKeys: {}, members: [],
  blacklistedTerms: [], blockEmails: false, blockIban: false, blockPhone: false, tags: [], openrouterModels: [],
  ...overrides,
});

const admin  = makeUser('admin');
const editor = makeUser('editor');
const member = makeUser('member');
const ws     = makeWorkspace();
const wsManaged = makeWorkspace({ isManaged: true });
const wsSolo    = makeWorkspace({ plan: 'Solo' });

describe('can — prompts:edit', () => {
  it('allows admin',  () => expect(can(admin,  ws, 'prompts:edit')).toBe(true));
  it('allows editor', () => expect(can(editor, ws, 'prompts:edit')).toBe(true));
  it('denies member', () => expect(can(member, ws, 'prompts:edit')).toBe(false));
});

describe('can — library:copy', () => {
  it('allows on Pro plan',     () => expect(can(member, ws,        'library:copy')).toBe(true));
  it('allows on Solo plan',    () => expect(can(member, wsSolo,    'library:copy')).toBe(true));
  it('allows on managed ws',   () => expect(can(member, wsManaged, 'library:copy')).toBe(true));
});

describe('can — team:manage', () => {
  it('allows admin',  () => expect(can(admin,  ws, 'team:manage')).toBe(true));
  it('denies editor', () => expect(can(editor, ws, 'team:manage')).toBe(false));
  it('denies member', () => expect(can(member, ws, 'team:manage')).toBe(false));
});

describe('can — api-keys:manage', () => {
  it('allows admin',  () => expect(can(admin,  ws, 'api-keys:manage')).toBe(true));
  it('allows editor', () => expect(can(editor, ws, 'api-keys:manage')).toBe(true));
  it('denies member', () => expect(can(member, ws, 'api-keys:manage')).toBe(false));
});

describe('can — plans:manage', () => {
  it('allows admin',  () => expect(can(admin,  ws, 'plans:manage')).toBe(true));
  it('denies editor', () => expect(can(editor, ws, 'plans:manage')).toBe(false));
  it('denies member', () => expect(can(member, ws, 'plans:manage')).toBe(false));
});

describe('can — settings:general', () => {
  it('allows admin',  () => expect(can(admin,  ws, 'settings:general')).toBe(true));
  it('allows editor', () => expect(can(editor, ws, 'settings:general')).toBe(true));
  it('denies member', () => expect(can(member, ws, 'settings:general')).toBe(false));
});
