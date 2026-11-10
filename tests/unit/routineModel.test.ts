import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MODEL, isUnavailableModel, randomStartTime, routineModelOptions } from '../../lib/routineModel';
import { FUNDED_MODEL_ID as EDITOR_FUNDED } from '../../lib/enabledModels';
import { FUNDED_MODEL_ID, resolveRoutineModel, workspaceDefaultModel } from '../../supabase/functions/_shared/routineModel';
import { providerOfModelId } from '../../supabase/functions/_shared/modelProvider';

/** SQEM-678 — the routine editor's model, start time and advanced section; the run's model on the server. */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const ws = (over: Partial<Parameters<typeof routineModelOptions>[0]> = {}) => ({
  apiKeys: {}, openrouterModels: [], fundedAvailable: false, authoringModelId: null, ...over,
}) as Parameters<typeof routineModelOptions>[0];

describe('the editor: workspace default or a concrete model', () => {
  it('a usable default AI model is offered and preselected', () => {
    const o = routineModelOptions(ws({ apiKeys: { claude: 'k' } as never, authoringModelId: 'claude-haiku-5-5' }));
    expect(o).toEqual({ defaultId: 'claude-haiku-5-5', initial: DEFAULT_MODEL });
  });

  it('keyless with credits: the default is the credits', () => {
    expect(routineModelOptions(ws({ fundedAvailable: true }))).toEqual({ defaultId: EDITOR_FUNDED, initial: DEFAULT_MODEL });
  });

  it('keys but no default set: no default offered, Chat\'s first model is written down', () => {
    const o = routineModelOptions(ws({ apiKeys: { claude: 'k' } as never }));
    expect(o.defaultId).toBeNull();
    expect(o.initial).toMatch(/^claude-/);
  });

  it('a default whose key is gone does not count as set', () => {
    const o = routineModelOptions(ws({ apiKeys: { openai: 'k' } as never, authoringModelId: 'claude-haiku-5-5' }));
    expect(o.defaultId).toBeNull();
  });

  it('a model the editor cannot list is unavailable', () => {
    expect(isUnavailableModel('claude-gone-1', [{ id: 'claude-haiku-5-5' }])).toBe(true);
    expect(isUnavailableModel('claude-haiku-5-5', [{ id: 'claude-haiku-5-5' }])).toBe(false);
    expect(isUnavailableModel('', [])).toBe(false);
  });

  it('the start time is a minute from 07:00 to 08:59, never the same default for everyone', () => {
    expect(randomStartTime(() => 0)).toBe('07:00');
    expect(randomStartTime(() => 0.9999)).toBe('08:59');
    expect(randomStartTime(() => 0.5)).toBe('08:00');
    for (let i = 0; i < 200; i++) expect(randomStartTime()).toMatch(/^0(7:[0-5]\d|8:[0-5]\d)$/);
  });
});

describe('the run: which model routine-run starts with', () => {
  const keys = new Set(['claude', 'openai']);

  it('the editor and the server mean the same credits id', () => {
    expect(FUNDED_MODEL_ID).toBe(EDITOR_FUNDED);
  });

  it('null = the default AI model with its key, otherwise the credits', () => {
    expect(workspaceDefaultModel('claude-haiku-5-5', keys)).toEqual({ modelId: 'claude-haiku-5-5' });
    expect(workspaceDefaultModel('gemini-3-pro', keys)).toEqual({ funded: true });
    expect(workspaceDefaultModel(null, keys)).toEqual({ funded: true });
    expect(resolveRoutineModel(null, 'claude-haiku-5-5', keys)).toEqual({ primary: { modelId: 'claude-haiku-5-5' }, fallback: null, replaced: null });
  });

  it('the credits chosen in the editor run on the credits (before SQEM-678 the id went to the provider)', () => {
    expect(resolveRoutineModel(FUNDED_MODEL_ID, 'claude-haiku-5-5', keys).primary).toEqual({ funded: true });
  });

  it('a chosen model stays, with the default as the one fallback', () => {
    expect(resolveRoutineModel('gpt-5.5', 'claude-haiku-5-5', keys)).toEqual({
      primary: { modelId: 'gpt-5.5' }, fallback: { modelId: 'claude-haiku-5-5' }, replaced: null,
    });
    expect(resolveRoutineModel('claude-haiku-5-5', 'claude-haiku-5-5', keys).fallback).toBeNull();
  });

  it('a chosen model whose key is gone, or that no provider is known for, runs on the default and says so', () => {
    expect(resolveRoutineModel('gemini-3-pro', 'claude-haiku-5-5', keys)).toEqual({ primary: { modelId: 'claude-haiku-5-5' }, fallback: null, replaced: 'gemini-3-pro' });
    expect(resolveRoutineModel('llama-old', null, keys)).toEqual({ primary: { funded: true }, fallback: null, replaced: 'llama-old' });
  });

  it('the provider is read from the id as chat-message always did', () => {
    expect(providerOfModelId('vendor/model')).toBe('openrouter');
    expect(providerOfModelId('gpt-5.5')).toBe('openai');
    expect(providerOfModelId('claude-haiku-5-5')).toBe('claude');
    expect(providerOfModelId('codestral-latest')).toBe('mistral');
    expect(providerOfModelId('unknown')).toBeNull();
  });
});

describe('wiring', () => {
  const EDITOR = read('pages/RoutineEditor.tsx');
  const RUN = read('supabase/functions/routine-run/index.ts');
  const CHAT = read('supabase/functions/chat-message/index.ts');

  it('the editor saves the default as null and keeps the advanced section closed until needed', () => {
    expect(EDITOR).toMatch(/model: model === DEFAULT_MODEL \? null : model \|\| null/);
    expect(EDITOR).toMatch(/useState\(false\);\n\s*const \[focusField/);
    expect(EDITOR).toMatch(/aria-expanded=\{advancedOpen\}/);
    expect(EDITOR).toMatch(/hidden=\{!advancedOpen\}/);
    expect(EDITOR).toMatch(/if \(first === 'model'\) setAdvancedOpen\(true\)/);
    expect(EDITOR).toMatch(/useState\(\(\) => randomStartTime\(\)\)/);
  });

  it('routine-run resolves the model before the start; chat-message tries the default once on an unknown model', () => {
    expect(RUN).toMatch(/resolveRoutineModel\(r\.model \?\? null, ws\?\.authoring_model_id/);
    expect(RUN).toMatch(/\.\.\.runModel\.primary/);
    expect(CHAT).toMatch(/chatErrorKind\(message\) === 'model' && routine\.ticket\.fallback/);
    // The second start carries no fallback, so there is no third.
    expect(CHAT).toMatch(/const \{ fallback, model, \.\.\.rest \} = t;/);
    expect(CHAT).toMatch(/providerOfModelId\(modelId\)/);
  });
});
