import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import EmptyState from '../../components/ui/EmptyState';
import { en } from './i18nText';

/** SQEM-388 — the Personas archive looks and behaves like the Templates archive. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('SQEM-388 — EmptyState has horizontal padding (it never did; both archives touched the edge)', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it('the card carries px-6 alongside its vertical padding', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(EmptyState, { icon: null, title: 'Nothing here', description: 'yet' })));
    const cls = host.firstElementChild!.getAttribute('class') ?? '';
    expect(cls.split(/\s+/)).toContain('px-6');
    expect(cls.split(/\s+/)).toContain('py-20');
  });
});

describe('SQEM-388 — the tab names the page', () => {
  it('pageTitleForPath knows /personas and the persona editor', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/pathname\.startsWith\('\/personas\/'\)\) return m\.title_persona_editor\(\)/);
    expect(app).toMatch(/pathname\.startsWith\('\/personas'\)\) return m\.nav_personas\(\)/);
    expect(en.title_persona_editor).toBe('Persona editor'); // SQEM-611
  });
});

describe('SQEM-388 — the Persona Wizard is offered where the first persona is created', () => {
  it('one wizardButton, rendered in the header and in the empty state', () => {
    const src = read('pages/Personas.tsx');
    expect(src).toMatch(/const wizardButton = !IS_SELF_HOSTED && canEdit \?/);
    expect(src.match(/\{wizardButton\}/g)?.length, 'header + empty state').toBe(2);
    const emptyAction = src.slice(src.indexOf('m.ps_create_first()') - 400, src.indexOf('m.ps_create_first()') + 200); // SQEM-605
    expect(emptyAction).toMatch(/\{wizardButton\}/);
  });
});
