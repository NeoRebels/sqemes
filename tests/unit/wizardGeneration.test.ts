import { describe, it, expect, vi, beforeEach } from 'vitest';

// wizardGeneration imports the supabase client (+ authoring AI) at load — mock the client.
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, functions: {} } }));

// SQEM-200 — the starter-library tests drive the generator sections through this one chokepoint.
// SQEM-390 — three sections now (brand voice · prompts · skills); the assistants section went with
// the kind, and the brand voice is one text call instead of role + examples.
const runAuthoringAI = vi.fn();
vi.mock('../../lib/authoringAI', () => ({
  runAuthoringAI: (...args: unknown[]) => runAuthoringAI(...args),
  firstTextModelId: () => 'gpt-test',
}));

const { extractVariables, questionLabels, generateStarterLibrary, generateSingleTemplate, generateStarterSkills, generateStarterPrompts } = await import('../../lib/wizardGeneration');

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

  // SQEM-390 — variables as questions (UX test, 2026-09-08: "Client Name" told the tester nothing).
  it('⛔ takes the model\'s question as the label, and the placeholders decide which variables exist', () => {
    const labels = questionLabels([
      { name: 'client_name', label: "What's the name of your client?" },
      { name: 'not_in_body', label: 'Ignored — no placeholder' },
      { name: '', label: 'no name' }, { label: 'no name either' }, 'garbage',
    ]);
    const vars = extractVariables('Write to {{client_name}} about {{product}}.', labels);
    expect(vars.map(v => [v.name, v.label])).toEqual([
      ['client_name', "What's the name of your client?"],
      ['product', 'Product'], // unlabelled → the title-cased name, as before
    ]);
    expect(questionLabels('not an array')).toEqual({});
  });
});

// SQEM-200 — a failing section used to be swallowed by `.catch(() => [])`, so a total failure
// reached the user as "generation returned nothing — please try again" with the real cause gone.
// These tests pin the two things that fixes: failures survive, and partial success still ships.
describe('generateStarterLibrary', () => {
  const BRAND = { brandName: 'Acme', whatItDoes: 'sells widgets', audience: 'buyers' };
  const CTX = { workspaceId: 'ws-1', modelId: 'gpt-test' };
  // SQEM-413 — the person picks the areas; one prompt and one skill are asked for per area.
  const AREAS = ['Marketing & Sales', 'Support & Success'];

  /** Route each section by the system instruction it sends, so tests can fail one at a time.
   *  Always async — the real `runAuthoringAI` is, and `generateBrandVoiceSkill` is awaited in a
   *  `.then()` chain. A synchronous mock would fail for the wrong reason. */
  const routeBy = (handlers: Record<string, () => string>) =>
    async ({ systemInstruction }: { systemInstruction: string }) => {
      if (systemInstruction.startsWith('Write a BRAND VOICE skill')) return handlers.brand?.() ?? '# Voice\nWarm, short.';
      if (systemInstruction.includes('starter prompt library')) return handlers.prompts?.() ?? '[]';
      if (systemInstruction.includes('reusable SKILLS')) return handlers.skills?.() ?? '[]';
      throw new Error(`unrouted section: ${systemInstruction.slice(0, 40)}`);
    };

  const ONE_PROMPT = JSON.stringify([{ title: 'Email', description: 'd', content: 'Write to {{name}}', variables: [{ name: 'name', label: 'Who is this for?' }], area: 'Marketing & Sales' }]);
  const ONE_SKILL = JSON.stringify([{ title: 'Tone', description: 'd', content: 'Stay warm.', area: 'Support & Success' }]);

  // Block body, not an expression: `mockReset()` returns the mock, and a function returned from
  // `beforeEach` is treated as a teardown callback — Vitest would then call the mock with no
  // arguments after every test, which blows up inside the router.
  beforeEach(() => { runAuthoringAI.mockReset(); });

  it('collects every section and reports no failures when all succeed', async () => {
    runAuthoringAI.mockImplementation(routeBy({ prompts: () => ONE_PROMPT, skills: () => ONE_SKILL }));

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX, AREAS);

    expect(failures).toEqual([]);
    // brand-voice skill + 1 prompt + 1 skill — every draft is one of the two kinds that exist
    expect(drafts.map(d => d.kind)).toEqual(['skill', 'prompt', 'skill']);
    expect(drafts[0].title).toBe('Acme Brand Voice');
    expect(drafts[0].content).toContain('Warm, short.');
    expect(drafts.find(d => d.kind === 'prompt')?.variables.map(v => [v.name, v.label])).toEqual([['name', 'Who is this for?']]);
  });

  it('⛔ SQEM-413 — asks for one prompt and one skill PER CHOSEN AREA, and names the areas', () => {
    // Pinned on the request, not the response: a mock returning drafts would prove nothing about what
    // the product asks for. Until SQEM-413 this was a fixed 4 + 3 for everyone (SQEM-390's numbers).
    const asked: string[] = [];
    runAuthoringAI.mockImplementation(async ({ systemInstruction }: { systemInstruction: string }) => { asked.push(systemInstruction); return '[]'; });
    return generateStarterLibrary(BRAND, CTX, AREAS).then(() => {
      expect(asked.some(s => s.includes('starter prompt library') && s.includes('exactly 2'))).toBe(true);
      expect(asked.some(s => s.includes('reusable SKILLS') && s.includes('EXACTLY ONE skill for each'))).toBe(true);
      for (const instruction of asked.filter(s => !s.startsWith('Write a BRAND VOICE skill'))) {
        expect(instruction).toContain('Marketing & Sales · Support & Success');
      }
      expect(asked.some(s => s.includes('assistant'))).toBe(false);
    });
  });

  it('⛔ SQEM-413 — a draft carries the area it belongs to; the brand voice carries none', async () => {
    runAuthoringAI.mockImplementation(routeBy({ prompts: () => ONE_PROMPT, skills: () => ONE_SKILL }));
    const { drafts } = await generateStarterLibrary(BRAND, CTX, AREAS);
    expect(drafts.map(d => d.area)).toEqual([undefined, 'Marketing & Sales', 'Support & Success']);
  });

  it('⛔ SQEM-413 — an area the model invented lands in the first CHOSEN area, not in a group nobody picked', async () => {
    runAuthoringAI.mockImplementation(routeBy({
      skills: () => JSON.stringify([{ title: 'T', description: 'd', content: 'c', area: 'Growth Hacking' }]),
    }));
    const { drafts } = await generateStarterLibrary(BRAND, CTX, AREAS);
    expect(drafts.find(d => d.title === 'T')?.area).toBe('Marketing & Sales');
  });

  it('⛔ SQEM-413 — a paraphrased area is matched case-insensitively, not by guessing', async () => {
    runAuthoringAI.mockImplementation(routeBy({
      skills: () => JSON.stringify([{ title: 'T', description: 'd', content: 'c', area: 'support & success' }]),
    }));
    const { drafts } = await generateStarterLibrary(BRAND, CTX, AREAS);
    expect(drafts.find(d => d.title === 'T')?.area).toBe('Support & Success');
  });

  it('keeps the drafts that worked and names the section that did not', async () => {
    runAuthoringAI.mockImplementation(routeBy({
      prompts: () => { throw new Error('Rate limit reached'); },  // rejects via the async router
      skills: () => ONE_SKILL,
    }));

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX, AREAS);

    expect(drafts.map(d => d.kind)).toEqual(['skill', 'skill']);
    expect(failures).toEqual([{ section: 'prompts', message: 'Rate limit reached' }]);
  });

  it('carries the real reason out when every section fails', async () => {
    runAuthoringAI.mockImplementation(async () => { throw new Error('Your OpenAI key was rejected'); });

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX, AREAS);

    expect(drafts).toEqual([]);
    expect(failures).toHaveLength(3);
    // The message must survive — this is the whole point of the ticket.
    expect(failures.every(f => f.message === 'Your OpenAI key was rejected')).toBe(true);
    expect(failures.map(f => f.section)).toEqual(['brand voice', 'prompts', 'skills']);
  });

  it('distinguishes "the model answered in prose" from "the calls failed"', async () => {
    // Every call succeeds; none of them returns parseable JSON.
    runAuthoringAI.mockImplementation(routeBy({
      brand: () => 'Sure! Here is how you sound…',
      prompts: () => 'Certainly, I can help with that.',
      skills: () => 'Of course.',
    }));

    const { drafts, failures } = await generateStarterLibrary(BRAND, CTX, AREAS);

    // The brand-voice skill still comes back — it needs no JSON, only the text.
    expect(drafts.map(d => d.kind)).toEqual(['skill']);
    expect(failures).toEqual([]);
  });
});

// SQEM-317 — the excerpt marker. A silent cut let the model judge a fragment as though it were the
// whole document; 8 000 characters was about two pages of a manual, and nothing said so.
describe('document truncation', () => {
  const BRAND = { brandName: 'Acme', whatItDoes: 'sells widgets', audience: 'buyers' };
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

// SQEM-412 — a model may answer with `content` as an OBJECT (the instructions describe a shape:
// Scope/Rules/Examples/Limits for a skill, Role/Context/Task for a prompt). `String(value)` turned
// that into "[object Object]" — shown in the preview and SAVED as the playbook's body.
describe('SQEM-412 — a draft body that arrives as an object', () => {
  beforeEach(() => runAuthoringAI.mockReset());

  const ctx = { workspaceId: 'w1', userId: 'u1', modelId: 'gpt-test' };

  it('turns an object body into Markdown instead of "[object Object]"', async () => {
    runAuthoringAI.mockResolvedValue(JSON.stringify([{
      title: 'Support tone',
      description: 'Apply when answering customers.',
      content: { scope: 'Customer replies.', rules: ['Always greet by name', 'Never promise a date'] },
    }]));
    const [draft] = await generateStarterSkills({ brandName: 'B', whatItDoes: 'x', audience: 'y' }, ctx, ['Marketing & Sales']);
    expect(draft.content).not.toContain('[object Object]');
    expect(draft.content).toContain('## Scope');
    expect(draft.content).toContain('Customer replies.');
    expect(draft.content).toContain('- Always greet by name');
  });

  it('drops a draft whose body holds nothing usable, rather than saving an empty playbook', async () => {
    runAuthoringAI.mockResolvedValue(JSON.stringify([{ title: 'Empty', description: 'd', content: {} }]));
    expect(await generateStarterSkills({ brandName: 'B', whatItDoes: 'x', audience: 'y' }, ctx, ['Marketing & Sales'])).toEqual([]);
  });

  it('extracts a prompt’s variables from the CONVERTED body, not from the raw object', async () => {
    runAuthoringAI.mockResolvedValue(JSON.stringify([{
      title: 'Reply draft',
      description: 'd',
      content: { task: 'Write a reply to {{customer}} about {{topic}}.' },
      variables: [{ name: 'customer', label: 'Customer' }],
    }]));
    const [draft] = await generateStarterPrompts({ brandName: 'B', whatItDoes: 'x', audience: 'y' }, ctx, ['Marketing & Sales']);
    expect(draft.content).toContain('{{customer}}');
    expect(draft.variables.map(v => v.name)).toEqual(['customer', 'topic']);
  });
});
