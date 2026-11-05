import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OWNER_GONE, matchesOwner, ownerOptions, usedTemplateIds } from '../../lib/listFilters';
import { en, de } from './i18nText';

const labels = { you: (n: string) => `${n} (you)`, gone: 'gone' };
const members = [
  { id: 'me', name: 'Mia', email: 'mia@x' },
  { id: 'a', name: 'Ben', email: 'ben@x' },
  { id: 'b', name: 'Anna', email: 'anna@x' },
  { id: 'c', name: 'Anna', email: 'anna2@x' },
];

describe('SQEM-620 — owner filter', () => {
  it('lists the owners of listed items: me first, then by name, then one entry for gone owners', () => {
    const items = [{ createdBy: 'a' }, { createdBy: 'me' }, { createdBy: 'b' }, { createdBy: 'zz' }, { createdBy: null }];
    expect(ownerOptions(items, members, 'me', labels)).toEqual([
      { value: 'me', label: 'Mia (you)' },
      { value: 'b', label: 'Anna' },
      { value: 'a', label: 'Ben' },
      { value: OWNER_GONE, label: 'gone' },
    ]);
  });

  it('two members with one name are told apart by their address', () => {
    const opts = ownerOptions([{ createdBy: 'b' }, { createdBy: 'c' }], members, 'me', labels);
    expect(opts.map(o => o.label).sort()).toEqual(['Anna (anna2@x)', 'Anna (anna@x)']);
  });

  it('⛔ fewer than two owners → no options, so the page shows no filter (Solo)', () => {
    expect(ownerOptions([{ createdBy: 'me' }, { createdBy: 'me' }], members, 'me', labels)).toEqual([]);
    expect(ownerOptions([], members, 'me', labels)).toEqual([]);
    // one member plus a gone owner are two choices
    expect(ownerOptions([{ createdBy: 'me' }, { createdBy: 'zz' }], members, 'me', labels)).toHaveLength(2);
  });

  it('matches by owner; "gone" means not recorded or not a member any more', () => {
    const ids = new Set(members.map(mb => mb.id));
    expect(matchesOwner('a', null, ids)).toBe(true);
    expect(matchesOwner('a', 'a', ids)).toBe(true);
    expect(matchesOwner('b', 'a', ids)).toBe(false);
    expect(matchesOwner('zz', OWNER_GONE, ids)).toBe(true);
    expect(matchesOwner(null, OWNER_GONE, ids)).toBe(true);
    expect(matchesOwner('a', OWNER_GONE, ids)).toBe(false);
  });
});

describe('SQEM-620 — list filters wired in', () => {
  it('"Not in a persona" knows every routed playbook once', () => {
    const used = usedTemplateIds([{ routes: [{ templateId: 'a' }, { templateId: 'b' }] }, { routes: [{ templateId: 'b' }] }, {}]);
    expect([...used].sort()).toEqual(['a', 'b']);
  });

  it('both lists filter by owner with a dropdown shown only when there are options, combined with the rest', () => {
    const t = readFileSync('pages/Templates.tsx', 'utf8');
    expect(t).toMatch(/return matchesSearch && matchesKind && matchesTag && matchesFavorite && matchesMine && matchesUnused;/);
    expect(t).toMatch(/const matchesMine = matchesOwner\(p\.createdBy, activeOwner, memberIds\);/);
    expect(t).toMatch(/\{owners\.length > 0 && \(\s*<SelectFilter icon=\{User\}/);
    expect(t).toMatch(/const activeOwner = owners\.length > 0 \? ownerFilter : null;/);
    const p = readFileSync('pages/Personas.tsx', 'utf8');
    expect(p).toMatch(/if \(!matchesOwner\(p\.createdBy, activeOwner, memberIds\)\) return false;/);
    expect(p).toMatch(/\{owners\.length > 0 && \(\s*<SelectFilter icon=\{User\}/);
  });

  it('both previews name the owner in an "Info" box — no third column', () => {
    const pb = readFileSync('components/PlaybookPreview.tsx', 'utf8');
    expect(pb).toMatch(/txt\.pv_info\(\)/);
    expect(pb).toMatch(/<OwnerLine createdBy=\{prompt\.createdBy\} members=\{members\} \/>/);
    expect(pb).toMatch(/<dl className="mt-5 grid gap-3 sm:grid-cols-2">/);
    const pp = readFileSync('components/PersonaPreview.tsx', 'utf8');
    expect(pp).toMatch(/<OwnerLine createdBy=\{persona\.createdBy\} members=\{members\} \/>/);
  });

  it('the labels exist in both languages; the old "Mine" ones are gone', () => {
    for (const k of ['flt_owner_label', 'flt_owner_all', 'flt_owner_you', 'flt_owner_gone', 'flt_unused', 'flt_unused_title', 'pv_info'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
    expect(de.flt_owner_all).not.toBe(en.flt_owner_all);
    expect(Object.keys(en).filter(k => k.startsWith('flt_mine'))).toEqual([]);
  });
});
