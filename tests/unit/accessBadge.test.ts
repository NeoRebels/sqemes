import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { accessBadgeMode, accessBadgeModes, ACCESS_BADGE_LABEL } from '../../lib/accessBadge';

/**
 * SQEM-400 — "Only me" and "Restricted" are two states; the card badge said "Restricted" for both.
 *
 * The mapping is pure (`lib/accessBadge.ts`) and tested directly; the rest is source assertions,
 * because the pages import the store and Supabase and cannot be rendered here.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments — `(/x/*)` inside a `//` line must not open a block.
const code = (src: string) => src.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-400 — one word per access state', () => {
  it('no rows = open (no badge)', () => {
    expect(accessBadgeMode([])).toBeUndefined();
  });

  it('the principal-less row is "only me"', () => {
    expect(accessBadgeMode([{}])).toBe('private');
    expect(accessBadgeMode([{ role: null, user_id: null, group_id: null }])).toBe('private');
  });

  it('a person, a group — or a legacy role — is "restricted"', () => {
    expect(accessBadgeMode([{ user_id: 'u1' }])).toBe('restricted');
    expect(accessBadgeMode([{ group_id: 'g1' }])).toBe('restricted');
    // ⛔ A role row from before SQEM-211 is a rule the control cannot express; it is NOT "only me".
    expect(accessBadgeMode([{ role: 'member' }])).toBe('restricted');
  });

  it('one named principal among principal-less rows still makes the entity "restricted"', () => {
    expect(accessBadgeMode([{}, { user_id: 'u1' }])).toBe('restricted');
  });

  it('groups by the entity id and answers per entity', () => {
    const modes = accessBadgeModes([
      { template_id: 'a' },
      { template_id: 'b', user_id: 'u1' },
      { template_id: 'b' },
      { template_id: 'c', group_id: 'g1' },
    ], 'template_id');
    expect(modes.get('a')).toBe('private');
    expect(modes.get('b')).toBe('restricted');
    expect(modes.get('c')).toBe('restricted');
    expect(modes.has('d')).toBe(false);
    // `Map.has` keeps every existing `.has(id)` call site meaning what it meant with the old Set.
    expect(modes.size).toBe(3);
  });

  it('the badge speaks the access control\'s words', () => {
    expect(ACCESS_BADGE_LABEL.private).toBe('Only me');
    expect(ACCESS_BADGE_LABEL.restricted).toBe('Restricted');
    // The control's option for the principal-less row is labelled the same way.
    expect(read('components/TemplateAccessControl.tsx')).toMatch(/Only me/);
  });
});

describe('SQEM-400 — the fetchers select the principals, the sites render the word', () => {
  it('all three fetchers read role / user / group, not just the id', () => {
    expect(code(read('lib/api/templateAccess.ts'))).toMatch(/select\('template_id, role, user_id, group_id'\)/);
    const persona = code(read('lib/api/personaAccess.ts'));
    expect(persona).toMatch(/select\('persona_id, user_id, group_id'\)/);
    expect(persona).toMatch(/select\('template_id, role, user_id, group_id'\)/);
    expect(persona).toMatch(/accessBadgeModes\(/);
  });

  it('⛔ no page hardcodes the word "Restricted" on a badge any more', () => {
    for (const file of ['pages/Templates.tsx', 'pages/Personas.tsx', 'pages/PersonaEditor.tsx']) {
      expect(code(read(file)), file).not.toMatch(/<Lock className="w-3 h-3" \/> Restricted/);
    }
  });

  it('the two card pages share one badge component; the route chip keeps its own weight but the same words', () => {
    expect(code(read('pages/Templates.tsx'))).toMatch(/<AccessBadge mode=\{accessMode\} \/>/);
    expect(code(read('pages/Personas.tsx'))).toMatch(/<AccessBadge mode=\{restrictedIds\.get\(persona\.id\)\} \/>/);
    const chip = code(read('pages/PersonaEditor.tsx'));
    expect(chip).toMatch(/ACCESS_BADGE_LABEL\[restrictedRouteIds\.get\(route\.templateId\)/);
    expect(chip).toMatch(/Only me — colleagues receive this persona without this route/);
    const badge = code(read('components/ui/AccessBadge.tsx'));
    expect(badge).toMatch(/ACCESS_BADGE_LABEL\[mode\]/);
    expect(badge).toMatch(/ACCESS_BADGE_TITLE\[mode\]/);
  });

  it('the persona archive\'s empty state carries the persona icon from the navigation', () => {
    const sidebar = code(read('components/Sidebar.tsx'));
    const nav = sidebar.match(/to: "\/personas", icon: (\w+), label: "Personas"/);
    expect(nav, 'sidebar personas entry').not.toBeNull();
    const icon = nav![1];
    const personas = code(read('pages/Personas.tsx'));
    const emptyIcons = [...personas.matchAll(/icon=\{[^}]*?<(\w+) className="w-8 h-8 [^"]*" \/>/g)].map(m => m[1]);
    expect(emptyIcons.length).toBeGreaterThanOrEqual(1);
    for (const name of emptyIcons) {
      if (name === 'Star') continue; // the favourites filter's own empty state keeps its star
      expect(name, 'empty-state icon').toBe(icon);
    }
  });
});
