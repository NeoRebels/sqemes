import type { AssistantBrandConfig, BrandVoiceExample, PromptKind, ToneLevel, Variable } from '../types';
import { runAuthoringAI } from './authoringAI';
import { compileAssistantInstruction, TONE_LABELS } from './compileBrandVoice';
import { supabase } from './supabase';

export interface BrandInput {
  brandName: string;
  whatItDoes: string;
  audience: string;
  tone: ToneLevel;
  /** Optional — what the team wants to use AI for. Sharpens prompt/skill generation. */
  useCase?: string;
}

export interface GenContext {
  workspaceId: string;
  /** BYOK model id, or null to route to Sqemes-funded credits (keyless). SQEM-082. */
  modelId: string | null;
}

/** A generated template the user reviews before it's saved into the workspace. */
export interface TemplateDraft {
  kind: PromptKind;
  title: string;
  description: string;
  content: string;
  systemInstruction?: string;
  brandConfig?: AssistantBrandConfig;
  variables: Variable[];
}

function brandSummary(b: BrandInput): string {
  const lines = [
    `Brand name: ${b.brandName}`,
    `What it does: ${b.whatItDoes}`,
    `Audience: ${b.audience}`,
    `Tone: ${TONE_LABELS[b.tone]}`,
  ];
  if (b.useCase?.trim()) lines.push(`Primary AI use case: ${b.useCase.trim()}`);
  return lines.join('\n');
}

function titleCase(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Extract {{placeholder}} tokens from content into Variable definitions (kind=prompt). */
export function extractVariables(content: string): Variable[] {
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const seen = new Set<string>();
  const vars: Variable[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    vars.push({ id: crypto.randomUUID(), name, label: titleCase(name), type: 'text' });
  }
  return vars;
}

/** Defensively parse a JSON array out of an LLM response (tolerates code fences / surrounding prose). */
function parseJsonArray(raw: string): any[] {
  let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Defensively parse a JSON object out of an LLM response. */
function parseJsonObject(raw: string): any {
  let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  try { return JSON.parse(text); } catch { return {}; }
}

function clampTone(n: unknown): ToneLevel {
  const v = Math.round(Number(n));
  if (v >= 1 && v <= 5) return v as ToneLevel;
  return 3;
}

/**
 * SQEM-035 Part 3 (Option B): the `analyze-website` edge function fetches + strips
 * the page to text (SSRF-guarded, no AI); the brand-field extraction runs here on
 * the single `runAuthoringAI` chokepoint (BYOK).
 */
export async function analyzeWebsite(url: string, ctx: GenContext): Promise<Partial<BrandInput>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ url, workspaceId: ctx.workspaceId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Could not read that website.');

  const systemInstruction =
    'Extract brand details from the website text below. Return ONLY a JSON object — no prose, no code fences — with keys "brandName" (string), "whatItDoes" (one sentence), "audience" (string), and "tone" (integer 1-5, where 1 = very formal and 5 = very casual). If a field is unknown, use an empty string (or 3 for tone).';
  const raw = await runAuthoringAI({ ...ctx, systemInstruction, prompt: String(data.text ?? ''), temperature: 0.3 });
  const obj = parseJsonObject(raw);
  return {
    brandName: String(obj.brandName ?? '').slice(0, 120),
    whatItDoes: String(obj.whatItDoes ?? '').slice(0, 300),
    audience: String(obj.audience ?? '').slice(0, 300),
    tone: clampTone(obj.tone),
  };
}

export async function generateBrandAssistant(b: BrandInput, ctx: GenContext): Promise<TemplateDraft> {
  const roleSys =
    'Write the ROLE description for an AI assistant that writes in this brand\'s voice. Address the assistant in the second person, e.g. "You are a [role] for [brand], which [does X] for [audience]. You help with…". 2–4 sentences. Output ONLY the role text — no labels, headings, or quotes.';
  const exampleSys =
    'Write 2 short examples that demonstrate this brand\'s voice at the given tone. Return ONLY a JSON array — no prose, no code fences — of objects with keys "input" (a realistic user request) and "output" (how the brand would respond, in voice).';

  const [brandContext, examplesRaw] = await Promise.all([
    runAuthoringAI({ ...ctx, systemInstruction: roleSys, prompt: brandSummary(b), temperature: 0.5 }).then(t => t.trim()),
    runAuthoringAI({ ...ctx, systemInstruction: exampleSys, prompt: brandSummary(b), temperature: 0.6 }).catch(() => ''),
  ]);

  const examples: BrandVoiceExample[] = parseJsonArray(examplesRaw)
    .filter(x => x?.input && x?.output)
    .slice(0, 2)
    .map(x => ({ id: crypto.randomUUID(), input: String(x.input), output: String(x.output) }));

  const brandConfig: AssistantBrandConfig = { tone: b.tone, brandContext, examples };
  return {
    kind: 'assistant',
    title: `${b.brandName} Brand Voice`,
    description: `Writes in ${b.brandName}'s brand voice and tone.`,
    content: '',
    brandConfig,
    systemInstruction: compileAssistantInstruction(brandConfig, ''),
    variables: [],
  };
}

export async function generateStarterAssistants(b: BrandInput, ctx: GenContext, count = 2): Promise<TemplateDraft[]> {
  const systemInstruction =
    `You build a starter set of AI assistants (personas) for a brand's team. An assistant is a reusable persona: a system instruction that sets its role, expertise, and behaviour for this brand. Generate exactly ${count} distinct, useful assistants (e.g. a customer-support agent, a content writer, a research analyst — tailored to this brand). Return ONLY a JSON array — no prose, no code fences — of objects with keys "title" (short), "description" (one sentence on what it's for), and "instruction" (the full system instruction / persona, addressing the assistant in the second person, 3–6 sentences).`;
  const raw = await runAuthoringAI({ ...ctx, systemInstruction, prompt: brandSummary(b), temperature: 0.7 });
  return parseJsonArray(raw)
    .filter(x => x?.title && x?.instruction)
    .slice(0, count)
    .map(x => ({
      kind: 'assistant' as const,
      title: String(x.title).slice(0, 120),
      description: String(x.description ?? '').slice(0, 300),
      content: '',
      systemInstruction: String(x.instruction),
      variables: [],
    }));
}

export async function generateStarterPrompts(b: BrandInput, ctx: GenContext, count = 5): Promise<TemplateDraft[]> {
  const systemInstruction =
    `You build a starter prompt library for a brand's team. Generate exactly ${count} reusable, practical prompt templates tailored to this brand's work. If a "Primary AI use case" is given, prioritise prompts that serve it. Each prompt MUST use {{variable_name}} placeholders for the user's inputs (snake_case names). Return ONLY a JSON array — no prose, no code fences — of objects with keys "title" (short), "description" (one sentence on when to use it), and "content" (the prompt body with {{placeholders}}).`;
  const raw = await runAuthoringAI({ ...ctx, systemInstruction, prompt: brandSummary(b), temperature: 0.7 });
  return parseJsonArray(raw)
    .filter(x => x?.title && x?.content)
    .slice(0, count)
    .map(x => ({
      kind: 'prompt' as const,
      title: String(x.title).slice(0, 120),
      description: String(x.description ?? '').slice(0, 300),
      content: String(x.content),
      variables: extractVariables(String(x.content)),
    }));
}

export async function generateStarterSkills(b: BrandInput, ctx: GenContext, count = 1): Promise<TemplateDraft[]> {
  const systemInstruction =
    `You build reusable AI "skills" for a brand. A skill is durable knowledge/instructions an AI agent applies when relevant — not a fill-in template. If a "Primary AI use case" is given, make the skill serve it. Generate exactly ${count}. Return ONLY a JSON array — no prose, no code fences — of objects with keys "title", "description" (one sentence describing WHEN to use the skill; agents use this to discover it), and "content" (the skill's instructions/knowledge).`;
  const raw = await runAuthoringAI({ ...ctx, systemInstruction, prompt: brandSummary(b), temperature: 0.7 });
  return parseJsonArray(raw)
    .filter(x => x?.title && x?.content)
    .slice(0, count)
    .map(x => ({
      kind: 'skill' as const,
      title: String(x.title).slice(0, 120),
      description: String(x.description ?? '').slice(0, 300),
      content: String(x.content),
      variables: [],
    }));
}

/** A section of the starter library that failed, with the reason kept intact. */
export interface SectionFailure {
  /** Human-readable section name, safe to show the user. */
  section: string;
  message: string;
}

export interface StarterLibraryResult {
  drafts: TemplateDraft[];
  /** Empty when every section succeeded. Never swallowed — see the note below. */
  failures: SectionFailure[];
}

/**
 * Generate the full starter library in parallel — **9 templates: 3 assistants, 3 prompts, 3 skills**
 * (SQEM-170; Cloud-only onboarding). The 3 assistants = the brand-voice assistant + 2 role personas.
 *
 * SQEM-200 — this used to be `Promise.all` with `.catch(() => [])` per section. The intent was right
 * (one failing section shouldn't cost the whole library) but the reason was thrown away with the
 * error. When *every* section failed the caller got an empty array and told the user "generation
 * returned nothing — please try again", which is misleading for the most common causes: a rejected
 * provider key or exhausted credits don't get better by retrying. The failures now travel back with
 * the drafts so the caller can say what actually happened.
 *
 * Note the two distinct empty outcomes, which need different messages:
 *   drafts empty + failures non-empty → the calls failed; `failures[0].message` is the real cause
 *   drafts empty + failures empty     → every call succeeded but `parseJsonArray` found no usable
 *                                       JSON, i.e. the model answered in prose. Retrying can help.
 */
export async function generateStarterLibrary(b: BrandInput, ctx: GenContext): Promise<StarterLibraryResult> {
  const sections: { label: string; run: () => Promise<TemplateDraft[]> }[] = [
    { label: 'brand voice', run: () => generateBrandAssistant(b, ctx).then(a => [a]) },
    { label: 'assistants', run: () => generateStarterAssistants(b, ctx, 2) },
    { label: 'prompts', run: () => generateStarterPrompts(b, ctx, 3) },
    { label: 'skills', run: () => generateStarterSkills(b, ctx, 3) },
  ];

  const settled = await Promise.allSettled(sections.map(s => s.run()));

  const drafts: TemplateDraft[] = [];
  const failures: SectionFailure[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      drafts.push(...outcome.value);
    } else {
      const reason = outcome.reason;
      failures.push({
        section: sections[i].label,
        message: reason instanceof Error ? reason.message : String(reason ?? 'Unknown error'),
      });
    }
  });

  return { drafts, failures };
}

// ---- Single template (SQEM-308) ---------------------------------------------------------------

/**
 * SQEM-308 — one template, from what the person says they want plus the brand.
 *
 * ⛔ **Deliberately here rather than in its own module.** The starter-library generators above solve
 * the same problem for a different occasion, and the useful improvements — the brand summary, the
 * JSON-array discipline, the variable extraction — are shared. A second generator beside this file
 * would inherit none of them and drift from the day it was written.
 *
 * `fileContext` is the text of the documents the person attached. ⚠️ **It is material to understand,
 * not the template's context files.** Somebody may attach a style guide so the model writes in that
 * style; whether the guide itself belongs on the finished template is a different question, and the
 * generation answers it (owner's decision, 2026-09-01) by naming what it wants kept in `keepFiles`.
 */
export async function generateSingleTemplate(
  kind: PromptKind,
  goal: string,
  fileContext: { name: string; text: string }[],
  b: BrandInput,
  ctx: GenContext,
): Promise<TemplateDraft & { keepFiles: string[] }> {
  const shape = kind === 'assistant'
    ? '"instruction" (the system instruction, second person, no preamble)'
    : '"content" (the body; use {{variable_name}} placeholders in snake_case wherever the user must supply something)';

  const kindRule = {
    prompt: 'A prompt is one task the person runs repeatedly. It must be specific enough to produce the same shape of result every time.',
    assistant: 'An assistant is a persona: who it is, how it writes, what it must never do. Not a task.',
    skill: 'A skill is a reusable block of company knowledge — a rule set, a policy, a way of doing something. Not a task and not a persona.',
  }[kind];

  const filesBlock = fileContext.length
    ? `

The person attached these documents as background. Use them to understand the subject. Then decide which, if any, the finished template should carry as context — list their exact names in "keepFiles", and leave it empty if none belong.

${fileContext.map(f => `--- ${f.name} ---
${f.text.slice(0, 8000)}`).join('\n\n')}`
    : '';

  const systemInstruction =
    `You build one reusable template for a brand's team. ${kindRule} Write it so a colleague who was not in this conversation can use it. Return ONLY a JSON object — no prose, no code fences — with keys "title" (short), "description" (one sentence on when to use it), ${shape}, and "keepFiles" (array of attached document names the template should keep as context; empty array if none).`;

  const raw = await runAuthoringAI({
    ...ctx,
    systemInstruction,
    prompt: `${brandSummary(b)}

What they want to achieve with this template:
${goal}${filesBlock}`,
    temperature: 0.7,
  });

  // Reuses the parser the starter generators already use — it was there, and writing a second one
  // is how two functions that must agree start disagreeing.
  const x = parseJsonObject(raw);
  const content = String(x?.content ?? '');
  const instruction = String(x?.instruction ?? '');
  if (!x?.title || (!content && !instruction)) {
    throw new Error('The model returned something this could not read as a template. Try describing the goal a little more concretely.');
  }

  return {
    kind,
    title: String(x.title).slice(0, 120),
    description: String(x.description ?? '').slice(0, 300),
    content,
    systemInstruction: instruction || undefined,
    variables: extractVariables(content),
    keepFiles: Array.isArray(x.keepFiles) ? x.keepFiles.map(String) : [],
  };
}
