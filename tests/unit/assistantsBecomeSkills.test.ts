import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KIND_HELP } from '../../constants';

/**
 * SQEM-390 — assistants became skills. Two template kinds: prompt (a task) and skill (knowledge).
 * The role an assistant used to hold is a persona.
 *
 * ⛔ **Why this is guarded and not just done.** The assistant kind was the same mechanism as a skill
 * (both ended up as text in one system instruction) wearing a different name, and the name had
 * grown UI around it in fifteen files — a filter tab here, a branch there, a column in a select
 * list. Any one of them coming back looks like a harmless addition and quietly re-creates the
 * question users kept asking ("what is the difference to a persona?"). These assertions read the
 * places where it would come back.
 *
 * ⚠️ Three files still say `'assistant'` on purpose, and the sweep names them: the bundle importer
 * and the marketplace submit endpoint READ it from a file written before 2026-09-13 and turn it
 * into a skill; the MCP server REFUSES it with a pointer to skills and personas. A reader is not a
 * kind.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// ⚠️ Line comments BEFORE block comments: `TemplateEditor` has `(/library/*)` inside a `//` line,
// which a block-first stripper reads as an opener and swallows four hundred lines with it.
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('SQEM-390 — the model', () => {
  it('⛔ PromptKind is prompt | skill', () => {
    expect(read('types.ts')).toMatch(/export type PromptKind = 'prompt' \| 'skill';/);
    expect(read('types.ts')).not.toMatch(/AssistantBrandConfig|BrandVoiceExample/);
  });

  it('KIND_HELP explains exactly those two', () => {
    expect(Object.keys(KIND_HELP).sort()).toEqual(['prompt', 'skill']);
  });

  it('the Prompt type carries no assistant-only field', () => {
    const prompt = code(read('types.ts')).match(/export interface Prompt \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(prompt).not.toMatch(/systemInstruction|brandConfig/);
  });

  it('the assistant-only modules are gone', () => {
    for (const f of ['lib/api/assistants.ts', 'components/AssistantSelect.tsx', 'components/BrandVoiceForm.tsx', 'lib/compileBrandVoice.ts']) {
      expect(existsSync(resolve(ROOT, f)), `${f} should not exist`).toBe(false);
    }
  });
});

describe('SQEM-390 — nowhere in the product is "assistant" still a kind', () => {
  // Where a kind is compared, listed or offered. A comment may say the word; code may not use it.
  const KIND_USE = /(?:kind\s*[:=]==?\s*|value:\s*|\[\s*'prompt'[^\]]*|\{\s*'prompt'[^}]*)'assistant'/;
  const LEGACY_READERS: Record<string, RegExp> = {
    'lib/templateBundle.ts': /const legacyAssistant = b\.kind === 'assistant';/,
    'supabase/functions/marketplace-submit/index.ts': /raw\.kind === 'assistant'/,
    'supabase/functions/mcp-server/index.ts': /if \(kind === 'assistant'\)\s*\n\s*return rpcError/,
  };

  it('⛔ the sweep', () => {
    const dirs = ['components', 'pages', 'lib', 'store', 'hooks', 'supabase/functions'].map(d => resolve(ROOT, d));
    const files = [...dirs.flatMap(d => walk(d)), resolve(ROOT, 'App.tsx'), resolve(ROOT, 'types.ts'), resolve(ROOT, 'constants.ts')];
    const hits: string[] = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1);
      const src = code(readFileSync(f, 'utf8'));
      if (!KIND_USE.test(src)) continue;
      const allowed = LEGACY_READERS[rel];
      if (allowed && allowed.test(src)) {
        // The reader is allowed — but nothing ELSE in that file may use the kind.
        const rest = src.replace(allowed, '');
        if (!KIND_USE.test(rest)) continue;
      }
      hits.push(rel);
    }
    expect(hits).toEqual([]);
  });

  it('⛔ no UI copy still says "assistants" — the subtitle on Templates did, two days after the kind went', () => {
    // The kind sweep above reads code; this reads what a person reads. Singular "assistant" stays
    // legal (a persona is adopted by "an AI assistant" — the model), the plural was the kind.
    const files = [...walk(resolve(ROOT, 'components')), ...walk(resolve(ROOT, 'pages'))];
    const hits = files
      .filter(f => /\bassistants\b/i.test(code(readFileSync(f, 'utf8'))))
      .map(f => f.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });

  it('the legacy readers really are readers — each turns the old kind into a skill or refuses it', () => {
    expect(read('lib/templateBundle.ts')).toMatch(/legacyAssistant \|\| b\.kind === 'skill' \? 'skill' : 'prompt'/);
    expect(read('lib/templateBundle.ts')).toMatch(/legacyAssistant \? \(b\.systemInstruction \|\| b\.content \|\| ''\)/);
    expect(read('supabase/functions/marketplace-submit/index.ts')).toMatch(/kind: 'skill', content: raw\.systemInstruction \|\| raw\.content/);
    expect(read('supabase/functions/mcp-server/index.ts')).toMatch(/kind "assistant" no longer exists/);
  });

  it('the MCP tools offer two kinds, and the library instruction describes two', () => {
    const mcp = code(read('supabase/functions/mcp-server/index.ts'));
    expect(mcp).toMatch(/enum: \['prompt', 'skill', 'all'\]/);
    expect(mcp.match(/enum: \['prompt', 'skill'\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(code(read('supabase/functions/_shared/libraryTools.ts'))).toMatch(/enum: \['prompt', 'skill'\]/);
    // `system_instruction` left every select and every write on the MCP path.
    for (const f of ['supabase/functions/mcp-server/index.ts', 'supabase/functions/_shared/libraryQueries.ts']) {
      expect(code(read(f)), f).not.toMatch(/system_instruction/);
    }
  });
});

describe('SQEM-390 — the surfaces', () => {
  it('the launch modal applies a skill and has no assistant callback', () => {
    const modal = code(read('components/TemplateLaunchModal.tsx'));
    expect(modal).not.toMatch(/onAssistantSelect/);
    expect(modal).toMatch(/if \(template\.kind === 'skill'\) \{/);
    // …and tells the person what applying does, instead of "inserted as-is".
    expect(modal).toMatch(/selected\?\.kind === 'skill' && \(/);
  });

  it('Chat holds one role — the persona — and skills; no assistant slot', () => {
    const chat = code(read('pages/Chat.tsx'));
    expect(chat).not.toMatch(/activeAssistantTemplate|selectedAssistantId|assistantId/);
    expect(chat).toMatch(/activePersona/);
    // the session API no longer writes or reads assistant_id
    const api = code(read('lib/api/chatSessions.ts'));
    expect(api).not.toMatch(/assistant_id: assistantId/);
    expect(api).not.toMatch(/assistantId\?: string/);
    expect(api).toMatch(/select\('applied_skill_ids, persona_id'\)/);
  });

  it('the editor offers two kinds and no brand-voice builder', () => {
    const editor = code(read('pages/TemplateEditor.tsx'));
    expect(editor).toMatch(/grid-cols-2 gap-1 bg-slate-100/);
    expect(editor).not.toMatch(/BrandVoiceForm|brandVoiceMode|compileAssistantInstruction/);
  });

  it('the test panel runs a skill as system context, the way Chat applies it', () => {
    const panel = code(read('components/EditorTestPanel.tsx'));
    expect(panel).toMatch(/template\.kind === 'skill' \? \(template\.content\.trim\(\) \|\| undefined\) : undefined/);
  });

  it('the Sidebar shows Personas with the Bot icon, and the old /assistants link lands on skills', () => {
    expect(code(read('components/Sidebar.tsx'))).toMatch(/\{ to: "\/personas", icon: Bot, label: "Personas" \}/);
    expect(code(read('App.tsx'))).toMatch(/path="\/assistants" element=\{<Navigate to="\/playbooks\?kind=skill" replace \/>\}/); // SQEM-394 moved the list
  });

  it('the wizard reviews two kinds', () => {
    const step = code(read('components/WizardCreateStep.tsx'));
    expect(step).not.toMatch(/assistant:/);
    expect(step).toMatch(/four prompts and four skills/);
  });
});

describe('SQEM-390 — the migration', () => {
  const SQL = read('supabase/migrations/20260913100000_sqem390_assistants_become_skills.sql');

  it('moves the rows of both tables and takes the instruction as the body', () => {
    expect(SQL.match(/update public\.(?:prompts|library_templates)\s+set kind\s+= 'skill'/g)?.length).toBe(2);
    expect(SQL.match(/case when coalesce\(system_instruction, ''\) <> '' then system_instruction else content end/g)?.length).toBe(2);
  });

  it('keeps a session’s applied assistant as its FIRST skill, then clears the column', () => {
    expect(SQL).toMatch(/array_prepend\(assistant_id, applied_skill_ids\)/);
    expect(SQL).toMatch(/assistant_id\s+= null/);
  });

  it('rewrites both kind constraints to two kinds', () => {
    expect(SQL).toMatch(/add constraint prompts_kind_check check \(kind in \('prompt', 'skill'\)\)/);
    expect(SQL).toMatch(/add constraint library_templates_kind_check check \(kind in \('prompt', 'skill'\)\)/);
  });

  it('checks its own work', () => {
    expect(SQL.match(/raise exception '\[SQEM-390\]/g)?.length).toBeGreaterThanOrEqual(5);
    expect(SQL).toMatch(/still carry kind=assistant/);
    expect(SQL).toMatch(/still carry an assistant_id/);
  });

  it('⚠️ leaves the legacy columns in place', () => {
    expect(SQL).not.toMatch(/drop column/i);
  });
});
