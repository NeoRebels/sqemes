import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import CardSaveBar from '../../components/ui/CardSaveBar';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { en } from './i18nText';

/**
 * SQEM-539 — settings save on a click, and deleting a workspace takes its name.
 *
 * The two primitives are rendered in jsdom; the wiring in `Settings.tsx` (too large to render here)
 * and `AuthoringModelCard` (it imports `lib/supabase`, which throws without env in CI) is pinned on
 * the source.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
const button = (text: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement;

describe('SQEM-539 — CardSaveBar', () => {
  let root: Root; let host: HTMLDivElement;
  let onSave: Mock<() => void>; let onCancel: Mock<() => void>;
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    onSave = vi.fn<() => void>(); onCancel = vi.fn<() => void>();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('is there while clean, but both buttons are disabled', () => {
    act(() => root.render(h(CardSaveBar, { dirty: false, onSave, onCancel })));
    expect(button('Save').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(host.textContent).not.toMatch(/Unsaved changes/);
  });

  it('dirty: says so, and Save / Cancel call through', () => {
    act(() => root.render(h(CardSaveBar, { dirty: true, onSave, onCancel })));
    expect(host.textContent).toMatch(/Unsaved changes/);
    act(() => { button('Save').click(); });
    act(() => { button('Cancel').click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('SQEM-539 — ConfirmModal with confirmText', () => {
  let root: Root; let host: HTMLDivElement; let onConfirm: Mock<() => void>;
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    onConfirm = vi.fn<() => void>();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const type = (value: string) => {
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  };

  it('stays locked until the exact name is typed (surrounding spaces forgiven)', () => {
    act(() => root.render(
      h(ConfirmModal, { open: true, title: 'Delete workspace "Acme"?', confirmText: 'Acme', confirmLabel: 'Delete workspace', onConfirm, onClose: () => {}, children: h('p', null, 'gone') }),
    ));
    expect(button('Delete workspace').disabled).toBe(true);
    type('acme');
    expect(button('Delete workspace').disabled).toBe(true);
    type('  Acme ');
    expect(button('Delete workspace').disabled).toBe(false);
    act(() => { button('Delete workspace').click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('without confirmText it is an ordinary confirmation', () => {
    act(() => root.render(
      h(ConfirmModal, { open: true, title: 'Delete?', onConfirm, onClose: () => {}, children: h('p', null, 'x') }),
    ));
    expect(document.querySelector('[role="dialog"] input')).toBeNull();
    expect(button('Confirm').disabled).toBe(false);
  });
});

describe('SQEM-539 — the wiring', () => {
  const settings = read('pages/Settings.tsx');

  it('no settings control writes on the click itself', () => {
    expect(settings).not.toMatch(/onChange=\{v => updateWorkspace\(\{ defaultTemplateAccess/);
    expect(settings).not.toMatch(/updateWorkspace\(\{ defaultEditRestricted: value \}\)/);
    expect(settings).not.toMatch(/onClick=\{\(\) => updateWorkspace\(\{ \[key\]: !workspace\[key\] \}\)\}/);
    expect(settings.match(/<CardSaveBar/g)?.length).toBe(3);
    const card = read('components/AuthoringModelCard.tsx');
    expect(card).toMatch(/onChange=\{e => setDraft\(e\.target\.value \|\| null\)\}/);
    expect(card).toMatch(/<CardSaveBar/);
  });

  it('a tab change with a draft asks first', () => {
    expect(settings).toMatch(/onClick=\{\(\) => requestTab\(tab\.id\)\}/);
    expect(settings).toMatch(/if \(hasUnsaved\) setPendingTab\(id\);/);
  });

  it('deleting the workspace names what goes and takes the name', () => {
    expect(settings).not.toMatch(/prompts, history, results/);
    expect(settings).toMatch(/\? m\.stg_delete_body_sub\(\)\s*: m\.stg_delete_body\(\)/); // SQEM-608 — the words live in messages/
    for (const k of ['stg_delete_body_sub', 'stg_delete_body'] as const) expect(en[k]).toMatch(/all playbooks, personas, files, chats and members/);
    expect(settings).toMatch(/confirmText: workspace\.name,/);
  });

  it('both editors use the same verbs', () => {
    expect(read('pages/TemplateEditor.tsx')).toMatch(/const saveLabel = isLibrary \? txt\.ed_save_playbook\(\) : id \? txt\.ed_save_changes\(\) : txt\.ed_create_playbook\(\);/);
    expect([en.ed_save_playbook, en.ed_save_changes, en.ed_create_playbook]).toEqual(['Save playbook', 'Save changes', 'Create playbook']); // SQEM-605
    expect(read('pages/PersonaEditor.tsx')).toMatch(/\{id \? m\.ed_save_changes\(\) : m\.pe_create\(\)\}/);
    expect(en.pe_create).toBe('Create persona'); // SQEM-605
  });
});
