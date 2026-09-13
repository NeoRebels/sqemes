import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { personaInstruction } from '../../lib/personaChat';
import type { Persona, Prompt } from '../../types';

/**
 * SQEM-389 — a persona card opens Chat with the persona as the session's role.
 *
 * The composition itself is pinned in `libraryReader.test.ts` (the MCP server's `composePersona`);
 * here: the wrapper's tolerance, and the wiring the Chat page cannot be rendered for.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const persona: Pick<Persona, 'title' | 'description' | 'content' | 'routes'> = {
  title: 'Sales',
  description: 'Everything a rep needs',
  content: 'You are the sales role. Be concrete.',
  routes: [
    { templateId: 't2', condition: 'a quote is being written', sortOrder: 2 },
    { templateId: 't1', condition: '', sortOrder: 1 },
    { templateId: 'gone', condition: 'never', sortOrder: 3 },
  ],
};
const templates: Pick<Prompt, 'id' | 'title' | 'kind' | 'description'>[] = [
  { id: 't1', title: 'Workshop Offer', kind: 'prompt', description: 'when a workshop is offered' },
  { id: 't2', title: 'Offer Layout', kind: 'skill', description: 'layout rules for quotes' },
];

describe('SQEM-389 — personaInstruction (lib/personaChat.ts)', () => {
  const text = personaInstruction(persona, templates);

  it('is the MCP composition: role prose plus a routing table of get_template calls', () => {
    expect(text).toMatch(/^---\npersona: Sales\n/);
    expect(text).toContain('You are the sales role.');
    expect(text).toContain('## Routes');
    // `toSlug` joins with underscores — the name every surface addresses a template by.
    expect(text).toContain('`get_template(name: "workshop_offer")`');
    expect(text).toContain('`get_template(name: "offer_layout")`');
  });

  it('orders routes by sortOrder and lets an empty condition fall back to the template description', () => {
    const i1 = text.indexOf('workshop_offer');
    const i2 = text.indexOf('offer_layout');
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(text).toContain('| when a workshop is offered |');
    expect(text).toContain('| a quote is being written |');
  });

  it('⛔ drops a route whose template is gone (deleted or invisible) instead of failing', () => {
    expect(text).not.toContain('gone');
    expect(text).not.toContain('never');
  });

  it('⛔ uses the MCP server\'s composer, not a copy', () => {
    const src = read('lib/personaChat.ts');
    expect(src).toMatch(/from '\.\.\/supabase\/functions\/_shared\/libraryQueries'/);
    expect(src).not.toMatch(/lines\.push\('---'\)/);
  });
});

describe('⛔ SQEM-389 — the wiring', () => {
  it('the migration adds a real FK with set null, and proves it', () => {
    const file = 'supabase/migrations/20260913040000_sqem389_chat_session_persona.sql';
    expect(existsSync(resolve(ROOT, file))).toBe(true);
    const sql = read(file);
    expect(sql).toMatch(/add column if not exists persona_id uuid references public\.personas\(id\) on delete set null/);
    expect(sql).toMatch(/raise exception '\[SQEM-389\]/);
    expect(read('lib/database.types.ts')).toMatch(/persona_id: string \| null;/);
  });

  it('the session API reads and writes persona_id, and the row carries it', () => {
    const api = code(read('lib/api/chatSessions.ts'));
    expect(api).toMatch(/select\('applied_skill_ids, persona_id'\)/); // SQEM-390 — assistant_id left the reader
    expect(api).toMatch(/if \('personaId' in applied\) patch\.persona_id = applied\.personaId \?\? null/);
    expect(api).toMatch(/persona_id: personaId \|\| null/);
    expect(api).toMatch(/personaId: row\.persona_id \|\| undefined/);
    // Every explicit column list that feeds rowToChatSession has to name it, or the list view lies.
    for (const m of api.matchAll(/\.select\('([^']*applied_skill_ids[^']*)'\)/g)) expect(m[1]).toContain('persona_id');
  });

  it('a persona card opens Chat; edit stays on the pencil', () => {
    const app = code(read('App.tsx'));
    expect(app).toMatch(/<Route path="\/personas\/:id" element=\{<PersonaChatRedirect \/>\} \/>/);
    expect(app).toMatch(/state: \{ launchPersonaId: id \}/);
    const personas = code(read('pages/Personas.tsx'));
    expect(personas).toMatch(/titleHref=\{`\/personas\/\$\{persona\.id\}`\}/);
    expect(personas).toMatch(/to=\{`\/personas\/\$\{persona\.id\}\/edit`\}/);
  });

  it('Chat: the persona is the role — applied, persisted, restored, cleared', () => {
    const chat = code(read('pages/Chat.tsx'));
    expect(chat).toMatch(/const \[activePersona, setActivePersona\] = useState<Persona \| null>\(null\)/);
    expect(chat).toMatch(/launchPersonaId/);
    // applying a persona persists it (SQEM-390: nothing else shares the slot any more)
    expect(chat).toMatch(/updateAppliedContext\(sessionId, \{ personaId: persona\.id \}\)/);
    // restore sets the persona's instruction, or nothing; new chat clears it; a pre-session persona rides through create
    expect(chat).toMatch(/setActiveSystemInstruction\(persona \? personaInstruction\(persona, prompts\) : ''\)/);
    // These two are anchored by their trailing comment, so they read the RAW source.
    const raw = read('pages/Chat.tsx');
    expect(raw).toMatch(/setActivePersona\(null\); \/\/ SQEM-389/);
    expect(raw).toMatch(/activePersona\?\.id, \/\/ SQEM-389/);
    // the pill
    expect(chat).toMatch(/<span className="opacity-60 font-medium">Persona<\/span>/);
    expect(chat).toMatch(/onClick=\{removePersona\}/);
  });
});
