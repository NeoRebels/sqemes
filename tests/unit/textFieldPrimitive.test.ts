import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * SQEM-602 — form text fields are `ui/Input` / `ui/Textarea`. Before: 52 hand-styled fields in 36
 * variants, 23 in the pre-redesign palette, while `Input` was used ten times and `Textarea` never.
 * This test keeps a new one from becoming variant 37.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * The bordered fields outside components/ui that are deliberately NOT form fields, by file → count:
 * - writing surfaces: the playbook and persona editor bodies;
 * - inline rename: a chat in the chat list, a file in Files;
 * - search inside a picker: playbook pick in the launch dialog, the persona wizard, the access
 *   dialog's people search, the persona editor's route picker;
 * - compact: the connector tile's form (two), the copy-a-URL field in Settings, a route's condition
 *   field in the persona editor, the test chat's composer, the marketplace admin's raw-JSON box.
 */
const EXCEPTION_COUNT: Record<string, number> = {
  'pages/Chat.tsx': 1,
  'pages/Files.tsx': 1,
  'pages/PersonaEditor.tsx': 3,
  'pages/Settings.tsx': 1,
  'pages/TemplateEditor.tsx': 1,
  'components/ConnectorsCard.tsx': 2,
  'components/EditorTestPanel.tsx': 1,
  'components/MarketplaceAdminEntry.tsx': 1,
  'components/PersonaWizardModal.tsx': 1,
  'components/TemplateAccessControl.tsx': 1,
  'components/TemplateLaunchModal.tsx': 1,
};

const NOT_TEXT = new Set(['checkbox', 'radio', 'file', 'hidden', 'color', 'range']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Raw text fields that look like a form field: a bordered, rounded class list — or a class list taken
 * from a variable, which is how two cards hid theirs from the first survey (BrandProfileForm's
 * `inputCls`, DocumentStyleCard's `FIELD`).
 */
function rawFields(file: string): number {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (tag === 'input' || tag === 'textarea') {
        const attr = (k: string) => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === k) as ts.JsxAttribute | undefined;
        const type = attr('type')?.initializer?.getText().replace(/['"{}]/g, '') ?? 'text';
        const cls = attr('className')?.initializer?.getText() ?? '';
        const bordered = /border/.test(cls) && /rounded/.test(cls);
        const fromVariable = /^\{\s*[A-Za-z_.]+\s*\}$/.test(cls);
        if (!NOT_TEXT.has(type) && (bordered || fromVariable)) n++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe('SQEM-602 — no hand-styled text field outside components/ui', () => {
  const counts = [...walk(join(ROOT, 'pages')), ...walk(join(ROOT, 'components'))]
    .map(p => relative(ROOT, p))
    .filter(p => !p.startsWith('components/ui/'))
    .map(p => [p, rawFields(join(ROOT, p))] as const);

  it('pages and components use ui/Input / ui/Textarea (or a named exception)', () => {
    const offenders = counts.filter(([p, n]) => n > (EXCEPTION_COUNT[p] ?? 0)).map(([p, n]) => `${p}: ${n}`);
    expect(offenders).toEqual([]);
  });

  it('the exceptions are exact (a converted one must leave the list)', () => {
    // The self-host export replaces MarketplaceAdminEntry with a stub that has no field (SQEM-614):
    // exact in the private repo, skipped there.
    const exported = !existsSync(resolve(ROOT, 'scripts/build-public-export.sh'));
    for (const [p, want] of Object.entries(EXCEPTION_COUNT)) {
      if (exported && p === 'components/MarketplaceAdminEntry.tsx') continue;
      expect([p, rawFields(join(ROOT, p))]).toEqual([p, want]);
    }
  });
});

describe('SQEM-602 — the primitives', () => {
  const src = read('components/ui/Input.tsx');
  const base = src.match(/const baseClasses =\s*'([^']+)'/)?.[1] ?? '';
  const tones = src.match(/const toneClasses[\s\S]*?\{([\s\S]*?)\};/)?.[1] ?? '';

  it('use the design tokens, not the pre-redesign palette, and rounded-control like ui/Select', () => {
    expect(base).toMatch(/rounded-control/);
    expect(base).toMatch(/placeholder:text-ink-subtle/);
    expect(base + tones).not.toMatch(/slate-|bg-white|brand-/);
    expect(tones).toMatch(/default: 'border-line-strong bg-surface-field focus:border-accent focus:ring-accent\/20'/);
  });

  it('have a disabled style and a dark color-scheme, like ui/Select', () => {
    expect(base).toMatch(/disabled:opacity-60 disabled:cursor-not-allowed/);
    expect(base).toMatch(/dark:\[color-scheme:dark\]/);
    expect(read('components/ui/Select.tsx')).toMatch(/rounded-control/);
  });

  it('a field state is a tone, not a call-site class list', () => {
    expect(tones).toMatch(/error: /);
    expect(tones).toMatch(/warning: /);
    expect(tones).toMatch(/success: /);
    expect(read('pages/Settings.tsx')).toMatch(/tone=\{hasExistingKey && !localValue \? 'success' : 'default'\}/);
    expect(read('components/Sidebar.tsx')).toMatch(/tone=\{workspaceNameError \? 'error' : 'default'\}/);
  });

  it('SecretInput is ui/Input underneath', () => {
    expect(read('components/ui/SecretInput.tsx')).toMatch(/<Input \{\.\.\.props\}/);
  });
});
