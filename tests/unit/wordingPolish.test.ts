import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import SegmentedTabs from '../../components/ui/SegmentedTabs';
import PickerDropdown from '../../components/ui/PickerDropdown';
import Modal from '../../components/ui/Modal';
import { en } from './i18nText';

/**
 * SQEM-544 — wording and polish: what a person reads, and what a screen reader is told.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const h = React.createElement;

describe('SQEM-544 — the words', () => {
  it('a persona uses "playbooks", not "routes", wherever a person reads it', () => {
    const editor = read('pages/PersonaEditor.tsx');
    expect(editor).toMatch(/label: m\.pe_tab_playbooks\(\), icon: <ListTree/);
    expect(editor).toMatch(/uppercase tracking-wider">\{m\.pe_tab_playbooks\(\)\}<\/p>/);
    expect(en.pe_tab_playbooks).toBe('Playbooks'); // SQEM-605
    expect(editor).not.toMatch(/>No routes yet</);
    // SQEM-554 (b) — the archive is a list + preview; the sentence moved to the preview, the row says it short.
    expect(read('components/PersonaPreview.tsx')).toMatch(/m\.ppv_empty\(\)/);
    expect(en.ppv_empty).toMatch(/^No playbooks yet — this persona loads nothing/);
    expect(read('pages/Personas.tsx')).toMatch(/m\.ps_loads_nothing\(\)/);
    expect(en.ps_loads_nothing).toBe('Loads nothing yet');
  });

  it('Chat and the playbooks page speak of playbooks', () => {
    expect(read('pages/Chat.tsx')).toMatch(/title=\{txt\.chat_use_playbook\(\)\}/);
    expect(en.chat_use_playbook).toBe('Use playbook  (/)'); // SQEM-604
    expect(read('pages/Templates.tsx')).toMatch(/subtitle=\{m\.pb_subtitle\(\)\}/);
    expect(en.pb_subtitle).toBe("Your team's playbooks — prompts for tasks, skills for knowledge."); // SQEM-605
  });

  it('the marketplace admin panel uses the brand colour', () => {
    expect(read('components/MarketplaceAdminEntry.tsx')).not.toMatch(/indigo-/);
  });
});

describe('SQEM-544 — structure', () => {
  it('each page that had none now has one h1', () => {
    for (const f of ['pages/Auth.tsx', 'pages/TemplateEditor.tsx', 'pages/PersonaEditor.tsx', 'pages/InviteAccept.tsx']) {
      expect(read(f).match(/<h1\b/g)?.length ?? 0, f).toBeGreaterThanOrEqual(1);
    }
  });

  it('a skip link focuses the main area without a fragment route', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/onClick=\{\(\) => mainRef\.current\?\.focus\(\)\}/);
    expect(app).toMatch(/>\s*\{m\.app_skip\(\)\}\s*</);
    expect(en.app_skip).toBe('Skip to content'); // SQEM-611
    expect(app).toMatch(/<main ref=\{mainRef\} id="main-content" tabIndex=\{-1\}/);
  });
});

describe('SQEM-544 — SegmentedTabs and PickerDropdown say their state', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('SegmentedTabs marks the active tab with aria-pressed', () => {
    act(() => root.render(h(SegmentedTabs<string>, { value: 'b', onChange: () => {}, tabs: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })));
    const [a, b] = [...host.querySelectorAll('button')];
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });

  const picker = () => h(PickerDropdown, {
    triggerIcon: null,
    triggerLabel: 'Pick',
    search: '',
    onSearchChange: () => {},
    children: () => h('button', { id: 'opt' }, 'Option'),
  });

  it('PickerDropdown reports expanded and closes on Escape, returning focus', () => {
    act(() => root.render(picker()));
    const trigger = host.querySelector('button')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    act(() => { trigger.click(); });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const input = host.querySelector('input')!;
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('⛔ inside a Modal, Escape closes the list, not the dialog', () => {
    let closed = 0;
    act(() => root.render(
      // `children` in the props object: ModalProps declares it required (see modalDragSelect.test.ts).
      h(Modal, { open: true, onClose: () => { closed++; }, children: h('div', null, h('h3', null, 'T'), picker()) }),
    ));
    const trigger = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent?.includes('Pick')) as HTMLButtonElement;
    act(() => { trigger.click(); });
    const input = document.querySelector('[role="dialog"] input')!;
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(closed).toBe(0);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
