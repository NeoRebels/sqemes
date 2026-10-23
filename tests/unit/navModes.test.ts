import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MODE_HOME, NAV_MODE_STORAGE_KEY, canManage, modeForPath, navRoutes, readRememberedMode, resolveMode, writeRememberedMode,
} from '../../lib/navMode';
import SegmentedTabs from '../../components/ui/SegmentedTabs';

/**
 * SQEM-548 — Work | Manage (redesign C): every page belongs to one mode; members
 * have no Manage. The Sidebar itself imports the store (and with it lib/supabase), so it is checked at
 * source level; the logic lives in lib/navMode.ts and is tested directly.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('SQEM-548 — which mode a route belongs to', () => {
  it.each([
    ['/', 'work'], ['/chat', 'work'], ['/chat/abc', 'work'], ['/history', 'work'], // SQEM-563
    ['/overview', 'manage'], ['/playbooks', 'manage'], ['/playbooks/new', 'manage'], ['/personas', 'manage'], ['/personas/x/edit', 'manage'],
    ['/files', 'manage'], ['/library', 'manage'], ['/library/42', 'manage'],
  ])('%s → %s', (path, mode) => {
    expect(modeForPath(path)).toBe(mode);
  });

  it.each(['/settings', '/design', '/invite/tok', '/nope', '/chatter', '/playbooks-old'])('%s is neutral', path => {
    expect(modeForPath(path)).toBeNull();
  });
});

describe('SQEM-548 — the mode in effect', () => {
  it('a neutral route keeps the remembered mode', () => {
    expect(resolveMode('/settings', 'admin', 'manage')).toBe('manage');
    expect(resolveMode('/settings', 'editor', 'work')).toBe('work');
    expect(resolveMode('/settings', 'admin', null)).toBe('work');
  });

  it('a route with a mode wins over the remembered one', () => {
    expect(resolveMode('/files', 'admin', 'work')).toBe('manage');
    expect(resolveMode('/', 'editor', 'manage')).toBe('work');
  });

  it('⛔ a member never gets Manage — not from the route, not from a stale stored value', () => {
    expect(canManage('member')).toBe(false);
    expect(resolveMode('/playbooks', 'member', 'manage')).toBe('work');
    expect(resolveMode('/settings', 'member', 'manage')).toBe('work');
  });
});

describe('SQEM-548 — the links per mode and role (Variante 1)', () => {
  it('Work: Start, Chat, History (SQEM-563); Manage: Overview, Playbooks, Personas, Files, Marketplace', () => {
    expect(navRoutes('work', 'admin', { marketplace: true })).toEqual(['/', '/chat', '/history']);
    expect(navRoutes('manage', 'editor', { marketplace: true })).toEqual(['/overview', '/playbooks', '/personas', '/files', '/library']);
  });

  it('no page appears in both modes', () => {
    const work = navRoutes('work', 'admin', { marketplace: true });
    const manage = navRoutes('manage', 'admin', { marketplace: true });
    expect(work.filter(r => manage.includes(r))).toEqual([]);
  });

  it('members get one list, whatever the mode', () => {
    for (const mode of ['work', 'manage'] as const) {
      expect(navRoutes(mode, 'member', { marketplace: true })).toEqual(['/', '/chat', '/history', '/playbooks', '/personas']);
    }
  });

  it('a self-host instance without a marketplace drops the link (SQEM-178)', () => {
    expect(navRoutes('manage', 'admin', { marketplace: false })).not.toContain('/library');
  });

  it('each mode lands on a page of its own mode', () => {
    expect(modeForPath(MODE_HOME.work)).toBe('work');
    expect(modeForPath(MODE_HOME.manage)).toBe('manage');
  });
});

describe('SQEM-548 — the remembered mode tolerates broken storage', () => {
  // The test environment may not provide localStorage at all — install a controllable one.
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const install = (store: Pick<Storage, 'getItem' | 'setItem'>) =>
    Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
  afterEach(() => { if (original) Object.defineProperty(window, 'localStorage', original); else delete (window as { localStorage?: Storage }).localStorage; });

  it('round-trips and ignores foreign values', () => {
    const data = new Map<string, string>();
    install({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
    writeRememberedMode('manage');
    expect(readRememberedMode()).toBe('manage');
    data.set(NAV_MODE_STORAGE_KEY, 'admin-mode');
    expect(readRememberedMode()).toBeNull();
  });

  it('a throwing localStorage is not an error', () => {
    install({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readRememberedMode()).toBeNull();
    expect(() => writeRememberedMode('work')).not.toThrow();
  });
});

describe('SQEM-548 — the Sidebar wires it up', () => {
  const src = read('components/Sidebar.tsx');

  it('the links come from navRoutes, not from a role check of its own', () => {
    expect(src).toMatch(/const visibleRoutes = navRoutes\(mode, role, \{ marketplace: MARKETPLACE_ENABLED \}\);/);
    expect(src).not.toMatch(/can\(currentUser, workspace, 'settings:general'\)/);
  });

  it('the switch is shown only to those who can manage, as SegmentedTabs (aria-pressed)', () => {
    expect(src).toMatch(/const showModeSwitch = canManage\(role\);/);
    expect(src).toMatch(/\{showModeSwitch && \(/);
    expect(src).toMatch(/<SegmentedTabs<NavMode>\s+fill/);
    expect(src).toMatch(/aria-label=\{mode === 'work' \? 'Switch to Manage' : 'Switch to Work'\}/);
  });

  it('Recent shows the person’s own three latest chats in Work only', () => {
    expect(src).toMatch(/const recentChats = mode === 'work'/);
    expect(src).toMatch(/chatSessions\.filter\(c => c\.isOwner\)/);
    expect(src).toMatch(/\.slice\(0, 3\)/);
  });
});

describe('SQEM-548 — SegmentedTabs fill', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('with fill, every tab takes an equal share; without, none does', () => {
    const tabs = [{ value: 'work', label: 'Work' }, { value: 'manage', label: 'Manage' }] as const;
    act(() => root.render(React.createElement(SegmentedTabs<'work' | 'manage'>, { value: 'work', onChange: () => {}, tabs, fill: true })));
    expect([...host.querySelectorAll('button')].every(b => b.className.includes('flex-1'))).toBe(true);
    act(() => root.render(React.createElement(SegmentedTabs<'work' | 'manage'>, { value: 'work', onChange: () => {}, tabs })));
    expect([...host.querySelectorAll('button')].some(b => b.className.includes('flex-1'))).toBe(false);
  });
});
