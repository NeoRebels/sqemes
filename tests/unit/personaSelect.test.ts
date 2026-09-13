import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PersonaSelect } from '../../components/PersonaSelect';
import type { Persona } from '../../types';

/**
 * SQEM-390 (PR C) — the persona picker in Chat.
 *
 * ⚠️ With the assistant kind gone, the launch modal offers no role. A person already in a
 * conversation could adopt one only by leaving for a persona card (SQEM-389). The picker sits where
 * the model is chosen; these tests render it (it imports nothing that touches the store) and read
 * the one place it is wired.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = resolve(__dirname, '../../');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const persona = (id: string, title: string, description = ''): Persona => ({
  id, workspaceId: 'ws', title, description, content: 'role', tags: [], routes: [],
  createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z',
} as Persona);

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
  root = null; host = null;
});
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('PersonaSelect', () => {
  it('opens on the trigger, lists every persona with its description, and applies the chosen one', () => {
    const onChange = vi.fn();
    const onOpen = vi.fn();
    const el = mount(React.createElement(PersonaSelect, {
      personas: [persona('p1', 'Sales', 'Offers and follow-ups'), persona('p2', 'Support')],
      value: null, onChange, onOpen,
    }));
    const trigger = el.querySelector('button')!;
    expect(trigger.textContent).toContain('No persona');
    click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const options = [...el.querySelectorAll('button')].slice(1);
    expect(options.map(b => b.textContent)).toEqual(['No persona', 'SalesOffers and follow-ups', 'Support']);
    click(options[1]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(el.querySelectorAll('button').length).toBe(1); // closed again
  });

  it('shows the applied persona on the trigger, and "No persona" removes it', () => {
    const onChange = vi.fn();
    const el = mount(React.createElement(PersonaSelect, { personas: [persona('p1', 'Sales')], value: 'p1', onChange }));
    expect(el.querySelector('button')!.textContent).toContain('Sales');
    click(el.querySelector('button')!);
    click([...el.querySelectorAll('button')][1]); // the "No persona" row
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('with no personas and an action: the trigger IS the CTA and opens nothing', () => {
    const onEmptyAction = vi.fn();
    const el = mount(React.createElement(PersonaSelect, {
      personas: [], value: null, onChange: () => {}, emptyActionLabel: 'Create a persona', onEmptyAction,
    }));
    const trigger = el.querySelector('button')!;
    expect(trigger.textContent).toContain('Create a persona');
    click(trigger);
    expect(onEmptyAction).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('button').length).toBe(1);
  });

  it('with no personas and no action (a member who may not create): a plain empty menu', () => {
    const el = mount(React.createElement(PersonaSelect, { personas: [], value: null, onChange: () => {} }));
    click(el.querySelector('button')!);
    expect([...el.querySelectorAll('button')].slice(1).map(b => b.textContent)).toEqual(['No persona']);
  });

  it('⛔ closes from a mousedown on document, never by stopping propagation', () => {
    const el = mount(React.createElement(PersonaSelect, { personas: [persona('p1', 'Sales')], value: null, onChange: () => {} }));
    click(el.querySelector('button')!);
    expect(el.querySelectorAll('button').length).toBeGreaterThan(1);
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(el.querySelectorAll('button').length).toBe(1);
    expect(readFileSync(resolve(ROOT, 'components/PersonaSelect.tsx'), 'utf8')).not.toMatch(/stopPropagation/);
  });
});

describe('SQEM-390 (PR C) — wired into Chat, beside the model', () => {
  const chat = code(readFileSync(resolve(ROOT, 'pages/Chat.tsx'), 'utf8'));

  it('renders the picker on the applied persona, applies through applyPersona and removes through removePersona', () => {
    expect(chat).toMatch(/<PersonaSelect[\s\S]{0,200}value=\{activePersona\?\.id \?\? null\}/);
    expect(chat).toMatch(/if \(!persona\) \{ removePersona\(\); return; \}\s*applyPersona\(persona\);/);
    // the pill's remove is the same function, not a second copy
    expect(chat.match(/const removePersona = /g)?.length).toBe(1);
    expect(chat).toMatch(/onClick=\{removePersona\}/);
  });

  it('sits right after the model select, and refreshes its list when opened', () => {
    const modelIdx = chat.indexOf('<ModelSelect');
    const personaIdx = chat.indexOf('<PersonaSelect');
    expect(modelIdx).toBeGreaterThan(0);
    expect(personaIdx).toBeGreaterThan(modelIdx);
    expect(chat.slice(modelIdx, personaIdx)).not.toMatch(/Using:/);
    expect(chat).toMatch(/onOpen=\{loadPersonas\}/);
    expect(chat).toMatch(/fetchPersonas\(workspace\.id\)/);
  });

  it('offers "Create a persona" only to somebody who may create one', () => {
    expect(chat).toMatch(/emptyActionLabel=\{can\(currentUser, workspace, 'prompts:edit'\) \? 'Create a persona' : undefined\}/);
    expect(chat).toMatch(/onEmptyAction=\{can\(currentUser, workspace, 'prompts:edit'\) \? \(\) => navigate\('\/personas'\) : undefined\}/);
  });
});
