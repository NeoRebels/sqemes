import { describe, it, expect, vi } from 'vitest';

// wizardGeneration imports the supabase client (+ authoring AI) at load — mock the client.
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, functions: {} } }));

const { extractVariables } = await import('../../lib/wizardGeneration');

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
