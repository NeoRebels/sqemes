import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import ts from 'typescript';

/**
 * SQEM-538 — every form label is bound to its field.
 *
 * Until this ticket 65 of 81 `<label>` elements were bound to nothing: no `htmlFor`, no control
 * inside. They looked right and announced nothing — a screen reader read the placeholder or
 * silence, and a click on the label focused nothing. A label that names a GROUP (a row of choice
 * cards, the owner card) is not a label; it is a heading, and is now written as one.
 *
 * This walks the TSX source with the TypeScript parser (not regexes, so a `<label` inside a
 * comment or a string cannot fool it) and fails on any `<label>` that has neither `htmlFor` nor a
 * control nested inside it.
 *
 * ⚠️ It walks the file system, not `git ls-files` — this test is exported to the self-host repo,
 * where the export has no git history to ask.
 */
const ROOT = resolve(__dirname, '../..');
const CONTROL = /^(input|select|textarea|Input|Textarea|Checkbox|SecretInput)$/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = [...tsxFiles(join(ROOT, 'pages')), ...tsxFiles(join(ROOT, 'components')), join(ROOT, 'App.tsx')];

const tagName = (n: ts.Node) =>
  ts.isJsxElement(n) ? n.openingElement.tagName.getText()
    : ts.isJsxSelfClosingElement(n) ? n.tagName.getText()
      : null;

function containsControl(n: ts.Node): boolean {
  let found = false;
  const walk = (x: ts.Node) => {
    if (found) return;
    const t = tagName(x);
    if (t && CONTROL.test(t)) { found = true; return; }
    ts.forEachChild(x, walk);
  };
  ts.forEachChild(n, walk);
  return found;
}

function unboundLabels(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'label') {
      const hasFor = n.openingElement.attributes.properties.some(p => p.name?.getText() === 'htmlFor');
      if (!hasFor && !containsControl(n)) {
        bad.push(`${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bad;
}

/**
 * SQEM-538 (b) — a click handler on a `div`/`span`/`li`/… makes something a control that a keyboard
 * cannot reach and a screen reader does not announce. Either it is a `<button>`, or it declares
 * what it is with `role` (a dialog backdrop is `role="presentation"`: its keyboard path is Escape).
 * The one exemption is a handler that only stops propagation — that is plumbing, not a control.
 */
const NON_INTERACTIVE = /^(div|span|li|ul|tr|td|p|img|section|article|header|footer|label)$/;
const STOP_ONLY = /^\(?\s*\w+\s*\)?\s*=>\s*\w+\.stopPropagation\(\)$/;

function clickableWithoutRole(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (n: ts.Node) => {
    const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (open && NON_INTERACTIVE.test(open.tagName.getText())) {
      const props = open.attributes.properties;
      const onClick = props.find(p => p.name?.getText() === 'onClick');
      const hasRole = props.some(p => p.name?.getText() === 'role');
      const handler = onClick && ts.isJsxAttribute(onClick) && onClick.initializer && ts.isJsxExpression(onClick.initializer)
        ? onClick.initializer.expression?.getText() ?? '' : '';
      if (onClick && !hasRole && !STOP_ONLY.test(handler)) {
        bad.push(`${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(open.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bad;
}

describe('SQEM-538 — fields and controls have names', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every <label> has htmlFor or wraps its control', () => {
    expect(files.flatMap(unboundLabels)).toEqual([]);
  });

  it('no div/span/li is clickable without saying what it is', () => {
    expect(files.flatMap(clickableWithoutRole)).toEqual([]);
  });

  it('the named controls keep their names', () => {
    const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
    expect(read('components/Sidebar.tsx')).toMatch(/aria-label=\{isCollapsed \? 'Expand sidebar' : 'Collapse sidebar'\}/);
    expect(read('pages/Chat.tsx')).toMatch(/onClick=\{handleSend\} aria-label="Send message"/);
    // SQEM-554 (d2) — the governance toggles are the shared Switch, which renders `labelledBy` as aria-labelledby.
    expect(read('pages/Settings.tsx')).toMatch(/labelledBy=\{`governance-\$\{key\}`\}/);
    expect(read('components/ui/Switch.tsx')).toMatch(/aria-labelledby=\{naming\.labelledBy\}/);
    expect(read('pages/Settings.tsx')).toMatch(/aria-label="Change profile picture"/);
  });

  it('the login fields tell a password manager what they are', () => {
    const auth = readFileSync(join(ROOT, 'pages/Auth.tsx'), 'utf8');
    expect(auth).toMatch(/autoComplete="email"/);
    expect(auth).toMatch(/autoComplete=\{mode === 'login' \? 'current-password' : 'new-password'\}/);
    const reset = readFileSync(join(ROOT, 'pages/ResetPassword.tsx'), 'utf8');
    expect(reset.match(/autoComplete="new-password"/g)?.length).toBe(2);
  });
});
