import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SQEM-547 — a kind is not a status.
 *
 * Skills used to borrow `success` (green), so "this is a skill" and "this worked" were one colour.
 * Redesign C gives the skill kind its own token (petrol); prompt stays on the accent.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const block = (css: string, sel: string) => {
  const re = new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map(m => m[2]).join('\n');
};
const rgb = (body: string, name: string) => {
  const m = body.match(new RegExp(`--${name}:\\s*(?:rgb\\()?(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!m) throw new Error(`--${name} not found`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const lum = (c: number[]) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('SQEM-547 — the skill kind has its own colour', () => {
  const css = read('index.css');
  const light = block(css, ':root');
  const dark = block(css, '.dark');

  it('skill is defined in both themes and differs from success', () => {
    expect(rgb(light, 'c-skill')).not.toEqual(rgb(light, 'c-success'));
    expect(rgb(dark, 'c-skill')).not.toEqual(rgb(dark, 'c-success'));
  });

  it('the skill label is readable on its badge ground (light) and on a dark card', () => {
    expect(ratio(rgb(light, 'c-skill'), rgb(light, 'c-skill-soft'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(dark, 'c-skill'), rgb(dark, 'c-surface-raised'))).toBeGreaterThanOrEqual(4.5);
  });

  it('KindBadge paints skills with the skill token, not with success or emerald', () => {
    const badge = read('components/ui/KindBadge.tsx');
    const skillLine = badge.split('\n').find(l => /^\s*skill: \{/.test(l))!;
    expect(skillLine).toMatch(/bg-skill-soft text-skill/);
    expect(skillLine).not.toMatch(/success|emerald/);
  });
});
