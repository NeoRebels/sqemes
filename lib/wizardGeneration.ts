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

/**
 * Generate the full starter library in parallel: one brand-voice assistant,
 * a handful of starter prompts, and one or two skills. Individual sections that
 * fail return empty so a partial library still comes back.
 */
export async function generateStarterLibrary(b: BrandInput, ctx: GenContext): Promise<TemplateDraft[]> {
  const [assistant, prompts, skills] = await Promise.all([
    generateBrandAssistant(b, ctx).then(a => [a]).catch(() => [] as TemplateDraft[]),
    generateStarterPrompts(b, ctx, 5).catch(() => [] as TemplateDraft[]),
    generateStarterSkills(b, ctx, 1).catch(() => [] as TemplateDraft[]),
  ]);
  return [...assistant, ...prompts, ...skills];
}
