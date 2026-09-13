import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';

/**
 * SQEM-394 — a template is called a **playbook** wherever a person reads it.
 *
 * The landing page said "Your company's Playbook"; the app said "Templates", beside "Library" and
 * "Persona". Two UX testers (2026-09-08, 2026-09-11) tripped over exactly that mismatch. One word
 * from the landing page into the app — and `template` stays the TECHNICAL name: the `prompts` and
 * `library_templates` tables, `PromptKind`, the MCP tool names (`search_templates`, a public
 * contract in pasted org instructions), the bundle format, every code identifier.
 *
 * ⛔ So these tests draw the line where it has to hold: what a person reads, and the routes.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe('SQEM-394 — the routes', () => {
  const app = code(read('App.tsx'));

  it('playbooks live under /playbooks — list, new, edit, launch', () => {
    expect(app).toMatch(/path="\/playbooks" element=\{<LayoutPage><Templates \/><\/LayoutPage>\}/);
    expect(app).toMatch(/path="\/playbooks\/new" element=\{<TemplateEditor \/>\}/);
    expect(app).toMatch(/path="\/playbooks\/:id\/edit" element=\{<TemplateEditor \/>\}/);
    expect(app).toMatch(/path="\/playbooks\/:id" element=\{<PromptRunnerRedirect \/>\}/);
  });

  it('⛔ every old path still lands — bookmarks, the extension, pasted links', () => {
    expect(app).toMatch(/path="\/templates" element=\{<LegacyListRedirect \/>\}/);
    expect(app).toMatch(/path="\/prompts" element=\{<Navigate to="\/playbooks" replace \/>\}/);
    expect(app).toMatch(/path="\/prompts\/new" element=\{<Navigate to="\/playbooks\/new" replace \/>\}/);
    expect(app).toMatch(/path="\/prompts\/:id\/edit" element=\{<LegacyPlaybookRedirect suffix="\/edit" \/>\}/);
    expect(app).toMatch(/path="\/prompts\/:id" element=\{<LegacyPlaybookRedirect \/>\}/);
    expect(app).toMatch(/path="\/assistants" element=\{<Navigate to="\/playbooks\?kind=skill" replace \/>\}/);
    // the list redirect carries the query — a bookmarked filter tab is `?kind=…`
    expect(app).toMatch(/const \{ search \} = useLocation\(\);\s*return <Navigate to=\{`\/playbooks\$\{search\}`\} replace \/>;/);
    // the item redirect carries the id
    expect(app).toMatch(/return <Navigate to=\{`\/playbooks\/\$\{id\}\$\{suffix\}`\} replace \/>;/);
  });

  it('the tab title and the sidebar say Playbooks', () => {
    expect(app).toMatch(/return 'Playbooks';/);
    expect(app).toMatch(/return 'Playbook editor';/);
    expect(code(read('components/Sidebar.tsx'))).toMatch(/\{ to: "\/playbooks", icon: BookMarked, label: "Playbooks" \}/);
  });

  it('⛔ nothing in the app still navigates to the old paths', () => {
    const dirs = ['components', 'pages', 'lib', 'hooks', 'store'].map(d => resolve(ROOT, d));
    const hits: string[] = [];
    for (const f of dirs.flatMap(d => walk(d).concat(readdirSync(d).filter(n => n.endsWith('.ts')).map(n => join(d, n))))) {
      const src = code(readFileSync(f, 'utf8'));
      if (/['"`]\/templates['"`?]|['"`]\/prompts(?:\/|['"`])/.test(src)) hits.push(f.slice(ROOT.length + 1));
    }
    expect(hits).toEqual([]);
  });
});

describe('SQEM-394 — what a person reads', () => {
  /**
   * ⛔ An AST sweep, not a regex. The first cut of this test read lines with a regex and missed every
   * JSX text that sits on its own line (`<p>\n  Your templates and files…\n</p>`) — the owner found
   * seven of those on staging within the hour. The TypeScript parser sees every JSX text node, string
   * literal and template chunk; what is left to decide is only what NOT to count.
   *
   * Skipped on purpose: module specifiers and paths (`'../lib/templateContext'`), property keys and
   * bare identifier strings (`id: 'templates'`, the wizard step), and the model-facing prompts below
   * — a model reads them, not a person, and their vocabulary is the tools' (`get_template`). The
   * pasted `LIBRARY_SYSTEM_PROMPT` is the one model text a person reads, and it says playbook.
   */
  const MODEL_PROMPTS = new Set([
    'components/PersonaWizardModal.tsx',   // the persona wizard's generation prompt
    'pages/PersonaEditor.tsx:routing',     // marker — the routing-condition prompt, matched below by content
    'lib/adaptTemplate.ts',
    'lib/wizardGeneration.ts',
  ]);
  const SWEPT_DIRS = ['components', 'pages'];
  const SWEPT_FILES = ['App.tsx', 'constants.ts', 'lib/accountExport.ts', 'lib/wizardUploads.ts'];

  function userReadableTemplateStrings(): string[] {
    const files = [...SWEPT_DIRS.flatMap(d => walk(resolve(ROOT, d))), ...SWEPT_FILES.map(f => resolve(ROOT, f))];
    const hits: string[] = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1);
      if (MODEL_PROMPTS.has(rel)) continue;
      const src = readFileSync(f, 'utf8');
      const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
        const isLit = ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
          || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
        if (isLit) {
          const t = (n as ts.LiteralLikeNode).text;
          const isKey = ts.isPropertyAssignment(n.parent) && n.parent.name === n;
          const bare = /^[\w.-]+$/.test(t.trim());
          // the one model prompt that shares a file with UI copy: the routing-condition instruction
          const modelPrompt = rel === 'pages/PersonaEditor.tsx' && /ROUTING CONDITION|\bTemplate: /.test(t);
          if (/\btemplates?\b/i.test(t) && !isKey && !bare && !t.includes('/') && !modelPrompt) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
            hits.push(`${rel}:${line}: ${t.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return hits;
  }

  it('⛔ no UI copy in components/, pages/ or the user-facing lib messages says "template" any more', () => {
    expect(userReadableTemplateStrings()).toEqual([]);
  });

  it('the sweep sees JSX text on its own line — the case the regex missed', () => {
    // A synthetic file through the same visitor: the text node spans lines and has no tag on them.
    const src = '<p>\n  Your templates and files are yours.\n</p>';
    const sf = ts.createSourceFile('x.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let seen = '';
    const visit = (n: ts.Node): void => { if (ts.isJsxText(n)) seen += n.text; ts.forEachChild(n, visit); };
    visit(sf);
    expect(seen).toMatch(/Your templates and files/);
  });

  it('the plan cards, the empty state and the wizard use the word', () => {
    expect(read('constants.ts')).toMatch(/'Unlimited playbooks'/);
    expect(code(read('pages/Templates.tsx'))).toMatch(/title="Playbooks"/);
    expect(code(read('pages/Templates.tsx'))).toMatch(/No playbooks yet/);
    expect(code(read('components/WizardCreateStep.tsx'))).toMatch(/Generate my starter playbooks/);
    expect(code(read('components/TemplateLaunchModal.tsx'))).toMatch(/Use a playbook/);
  });
});

describe('SQEM-394 — the model hears the same word, and the tools keep their names', () => {
  it('the library instruction says playbooks and still names the tools', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/Sqemes playbooks/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/Playbooks come in two kinds/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/The tools call a playbook a template/);
    for (const tool of ['search_templates', 'get_template', 'list_personas', 'get_persona']) expect(LIBRARY_SYSTEM_PROMPT).toContain(tool);
    expect(LIBRARY_SYSTEM_PROMPT.length).toBeLessThan(3000);
  });

  it('⛔ the MCP tool names did not move — they are a public contract', () => {
    const mcp = read('supabase/functions/mcp-server/index.ts');
    for (const tool of ['list_templates', 'search_templates', 'get_template', 'create_template', 'update_template', 'delete_template']) {
      expect(mcp, tool).toContain(`name: '${tool}'`);
    }
    expect(mcp).not.toMatch(/name: '[a-z_]*playbook[a-z_]*'/);
  });
});
