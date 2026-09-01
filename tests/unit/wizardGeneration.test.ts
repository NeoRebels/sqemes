import { describe, it, expect, vi, beforeEach } from 'vitest';

// wizardGeneration imports the supabase client (+ authoring AI) at load — mock the client.
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, functions: {} } }));

// SQEM-200 — the starter-library tests drive the four generator sections through this one chokepoint.
const runAuthoringAI = vi.fn();
vi.mock('../../lib/authoringAI', () => ({
  runAuthoringAI: (...args: unknown[]) => runAuthoringAI(...args),
  firstTextModelId: () => 'gpt-test',
}));

const { extractVariables, generateStarterLibrary, generateSingleTemplate } = await import('../../lib/wizardGeneration');

// SQEM-184 — the real {{placeholder}} → Variable[] extraction (kind=prompt auto-variables).
describe('extractVariables', () => {
  it('extracts distinct placeholder names in order', () => {
    const vars = extractVariables('Hello {{name}}, your role is {{role}}.');
    expect(vars.map(v => v.name)).toEqual(['name', 'role']);
    expect(vars.every(v => v.type === 'text')).toBe(true);
  });

  it('dedupes repeated placeholders', () => {
    expect(extractVariables('{{x}} and {{x}} again').map(v => v.name)).toEqual(['x']);
  });

  it('title-cases the label from a snake_case name', () => {
    expect(extractVariables('{{first_name}}')[0].label).toBe('First Name');
  });

  it('ignores malformed / non-identifier tokens and tolerates whitespace', () => {
    expect(extractVariables('{{ good }} {{123bad}} {{ }} {{}}').map(v => v.name)).toEqual(['good']);
  });

  it('returns [] when there are no placeholders', () => {
    expect(extractVariables('plain content, no vars')).toEqual([]);
  });
});

// SQEM-200 — a failing section used to be swallowed by `.catch(() => [])`, so a total failure
// reached the user as "generation returned nothing — please try again" with the real cause gone.
// These tests pin the two things that fixes: failures survive, and partial success still ships.
describe('generateStarterLibrary', () => {
  const BRAND = { brandName: 'Acme', whatItDoes: 'sells widgets', audience: 'buyers', tone: 3 as const };
  const CTX = { workspaceId: 'ws-1', modelId: 'gpt-test' };

  /** Route each section by the system instruction it sends, so tests can fail one at a time.
   *  Always async — the real `runAuthoringAI` is, and `generateBrandAssistant` calls `.then()`
   *  on its result. A synchronous mock would fail for the wrong reason. */
  const routeBy = (handlers: Record<string, () => string>) =>
    async ({ systemInstruction }: { systemInstruction: string }) => {
      if (systemInstruction.startsWith('Write the ROLE')) return handlers.role?.() ?? 'a role';
      if (systemInstruction.startsWith('Write 2 short examples')) return handlers.examples?.() ?? '[]';
      if (systemInstruction.includes('starter set of AI assistants')) return handlers.assistants?.() ?? '[]';
      if (systemInstruction.includes('starter prompt library')) return handlers.prompts?.() ?? '[]';
      if (systemInstruction.includes('reusable AI "skills"')) return handlers.skills?.() ?? '[]';
      throw new Error(`unrouted section: ${systemInstruction.slice(0, 40)}`);
    };

  const ONE_ASSISTANT = JSON.stringify([{ title: 'Support', description: 'd', instruction: 'You help.' }]);
  const ONE_PROMPT = JSON.stringify([{ title: 'Email', description: 'd', content: 'Write to {{name}}' }]);
  const ONE_SKILL = JSON.stringify([{ title: 'Tone', description: 'd', content: 'Stay warm.' }]);

  // Block body, not an expression: `mockReset()` returns the mock, and a function returned from
  // `beforeEach` is treated as a teardown callback — Vitest would then call the mock with no
  // arguments after every test, which blows up inside the router.
  beforeEach(() => { runAuthoringAI.mockReset(); });

  it('collects every section and reports no failures when all succeed', async () => {
    runAuthoringAI.mockImplementation(routeBy({
      assistants: () => ONE_ASSISTANT, prompts: () => ONE_PROMPT, skills: () => ONE_SKILL,
    }));

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX);

    expect(failures).toEqual([]);
    // brand-voice assistant + 1 assistant + 1 prompt + 1 skill
    expect(drafts.map(d => d.kind)).toEqual(['assistant', 'assistant', 'prompt', 'skill']);
    expect(drafts.find(d => d.kind === 'prompt')?.variables.map(v => v.name)).toEqual(['name']);
  });

  it('keeps the drafts that worked and names the section that did not', async () => {
    runAuthoringAI.mockImplementation(routeBy({
      assistants: () => ONE_ASSISTANT,
      prompts: () => { throw new Error('Rate limit reached'); },  // rejects via the async router
      skills: () => ONE_SKILL,
    }));

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX);

    expect(drafts.map(d => d.kind)).toEqual(['assistant', 'assistant', 'skill']);
    expect(failures).toEqual([{ section: 'prompts', message: 'Rate limit reached' }]);
  });

  it('carries the real reason out when every section fails', async () => {
    runAuthoringAI.mockImplementation(async () => { throw new Error('Your OpenAI key was rejected'); });

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX);

    expect(drafts).toEqual([]);
    expect(failures).toHaveLength(4);
    // The message must survive — this is the whole point of the ticket.
    expect(failures.every(f => f.message === 'Your OpenAI key was rejected')).toBe(true);
    expect(failures.map(f => f.section)).toEqual(['brand voice', 'assistants', 'prompts', 'skills']);
  });

  it('distinguishes "the model answered in prose" from "the calls failed"', async () => {
    // Every call succeeds; none of them returns parseable JSON.
    runAuthoringAI.mockImplementation(routeBy({
      assistants: () => 'Sure! Here are some ideas…',
      prompts: () => 'Certainly, I can help with that.',
      skills: () => 'Of course.',
    }));

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX);

    // The brand-voice assistant still comes back — it needs no JSON, only the role text.
    expect(drafts.map(d => d.kind)).toEqual(['assistant']);
    expect(failures).toEqual([]);
  });
});

// SQEM-317 — the excerpt marker. A silent cut let the model judge a fragment as though it were the
// whole document; 8 000 characters was about two pages of a manual, and nothing said so.
describe('document truncation', () => {
  const BRAND = { brandName: 'Acme', whatItDoes: 'sells widgets', audience: 'buyers', tone: 3 as const };
  const CTX = { workspaceId: 'ws-1', modelId: 'gpt-test' };
  const ok = JSON.stringify({ title: 'T', description: 'd', content: 'c', newFiles: [], inspectFiles: [] });

  // ⛔ Block body — see the note in the block above. An expression body returns the mock, Vitest
  //    treats that as a teardown callback and calls it with no arguments after every test.
  //    I walked into this exact trap while adding these tests, three lines below where it is written.
  beforeEach(() => { runAuthoringAI.mockReset(); });

  const promptFor = async (text: string) => {
    let seen = '';
    runAuthoringAI.mockImplementation(async (args: any) => { seen = args.prompt; return ok; });
    await generateSingleTemplate('prompt', 'goal', [{ name: 'doc.md', text }], [], [], BRAND, CTX);
    return seen;
  };

  it('marks an excerpt in the prompt instead of cutting silently', async () => {
    const seen = await promptFor('x'.repeat(50_000));
    expect(seen).toContain('Excerpt');
    expect(seen).toContain('50,000 characters');
  });

  it('leaves a document that fits completely unmarked', async () => {
    const seen = await promptFor('all of it');
    expect(seen).toContain('all of it');
    expect(seen).not.toContain('Excerpt');
  });
});
