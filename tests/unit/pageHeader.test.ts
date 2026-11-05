import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import PageHeader from '../../components/ui/PageHeader';

/**
 * SQEM-384 (follow-up) — the list-page header is one component, and its two halves are what keeps a
 * long subtitle from wrapping a button label.
 *
 * ⛔ Found by the owner on staging: the Personas subtitle SQEM-384 had just lengthened pushed the
 * actions until "Persona Wizard" broke onto two lines. The markup was copied into four pages; the
 * fix is one component, and this file makes sure it stays one.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = resolve(__dirname, '../../');
/** The exact wrapper line the four pages used to carry — now allowed in the component only. */
// SQEM-632 — the row inside the size container; the container itself carries the bottom margin.
const RAW_HEADER = 'flex flex-col [@container(min-width:56rem)]:flex-row [@container(min-width:56rem)]:items-end justify-between gap-4';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('SQEM-384 — PageHeader renders title, subtitle and actions', () => {
  it('shows all three, with the actions in their own column', () => {
    const el = mount(
      React.createElement(PageHeader, {
        title: 'Personas',
        subtitle: 'A working role — an AI role, not a team member.',
        actions: React.createElement('button', { id: 'wizard' }, 'Persona Wizard'),
      }),
    );
    expect(el.querySelector('h1')?.textContent).toBe('Personas');
    expect(el.querySelector('p')?.textContent).toContain('not a team member');
    const button = el.querySelector('#wizard')!;
    expect(button.parentElement).not.toBe(el.querySelector('h1')!.parentElement);
  });

  it('renders no actions column when actions is falsy (a `canEdit &&` guard)', () => {
    const el = mount(React.createElement(PageHeader, { title: 'Files', actions: false }));
    // Exactly one child of the header row: the text block.
    expect(el.firstElementChild!.firstElementChild!.children.length).toBe(1);
  });
});

describe('⛔ SQEM-384 — the 50/50 split, and why a label can no longer wrap', () => {
  it('SQEM-632 — the split follows the header width (a size container), not the window', () => {
    const el = mount(React.createElement(PageHeader, { title: 'T', actions: React.createElement('button', null, 'A') }));
    expect(classes(el.firstElementChild)).toContain('[container-type:inline-size]');
  });

  function halves() {
    const el = mount(
      React.createElement(PageHeader, {
        title: 'T',
        subtitle: 'S',
        actions: React.createElement('button', null, 'A'),
      }),
    );
    const row = el.firstElementChild!.firstElementChild!; // SQEM-632 — inside the size container
    return { text: row.children[0], actions: row.children[1] };
  }

  it('the text block is capped at half and may shrink below its content', () => {
    const { text } = halves();
    expect(classes(text)).toContain('[@container(min-width:56rem)]:w-1/2');
    // Without `min-w-0` a flex item refuses to shrink below its content — the text would win the
    // fight for space and the buttons would wrap, which is the bug.
    expect(classes(text)).toContain('min-w-0');
  });

  it('the actions block takes half, right-aligned, and its labels never wrap — on any width', () => {
    const { actions } = halves();
    const c = classes(actions);
    expect(c).toContain('[@container(min-width:56rem)]:w-1/2');
    expect(c).toContain('[@container(min-width:56rem)]:justify-end');
    // `white-space` is inherited: one class on the wrapper covers every button label inside it.
    expect(c).toContain('whitespace-nowrap');
    // ⛔ The ROW wraps instead (seen 2026-09-12: three buttons, two-line labels) — on
    // every width since SQEM-632: a nowrap row wider than its half ran over the subtitle at ~1040 px.
    expect(c).toContain('flex-wrap');
    expect(c).not.toContain('sm:flex-nowrap');
  });
});

describe('⛔ SQEM-384 — the header is one component, not four copies', () => {
  const pages = readdirSync(resolve(ROOT, 'pages')).filter(f => /\.tsx$/.test(f));

  it('no page carries the raw header wrapper any more', () => {
    const hits = pages.filter(f => readFileSync(join(ROOT, 'pages', f), 'utf8').includes(RAW_HEADER));
    expect(hits, 'use <PageHeader> instead of copying the wrapper').toEqual([]);
  });

  it('the four list pages use PageHeader', () => {
    for (const f of ['Templates.tsx', 'Personas.tsx', 'Files.tsx', 'Library.tsx']) {
      const src = readFileSync(join(ROOT, 'pages', f), 'utf8');
      expect(src, f).toMatch(/import PageHeader from '\.\.\/components\/ui\/PageHeader'/);
      expect(src, f).toMatch(/<PageHeader\b/);
    }
  });

  it('the component itself is the only carrier of the wrapper line', () => {
    const src = readFileSync(resolve(ROOT, 'components/ui/PageHeader.tsx'), 'utf8');
    expect(src).toContain(RAW_HEADER);
  });
});
