import { describe, it, expect, vi } from 'vitest';

// We test the pure rowToPrompt transformation without hitting Supabase.
// The module imports `supabase` at the top level, so we mock it.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// After mocking, import the function under test
const { rowToPrompt } = await import('../../lib/api/prompts');

describe('rowToPrompt', () => {
  it('maps all DB columns to Prompt fields', () => {
    const row = {
      id: 'abc-123',
      workspace_id: 'ws-1',
      kind: 'prompt',
      title: 'My Prompt',
      description: 'A description',
      tag: 'ai',
      variables: [{ name: 'input', type: 'text', label: 'Input' }],
      steps: [{ id: 's1', content: 'Hello', assistantId: 'a1' }],
      content: null,
      system_instruction: null,
      context_file_ids: [],
      skill_ids: [],
      model: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      created_by: 'user-1',
      usage_count: 5,
      folder_id: 'folder-1',
      is_favorite: true,
      published: false,
    };

    const prompt = rowToPrompt(row);

    expect(prompt.id).toBe('abc-123');
    expect(prompt.title).toBe('My Prompt');
    expect(prompt.description).toBe('A description');
    expect(prompt.tag).toBe('ai');
    expect(prompt.variables).toHaveLength(1);
    expect(prompt.content).toBe('Hello'); // legacy fallback from steps[0].content
    expect(prompt.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(prompt.updatedAt).toBe('2024-01-02T00:00:00Z');
    expect(prompt.createdBy).toBe('user-1');
    expect(prompt.usageCount).toBe(5);
    expect(prompt.isFavorite).toBe(true);
    expect(prompt.published).toBe(false);
  });

  it('uses empty arrays/strings when tags/variables/steps/content are null', () => {
    const row = {
      id: 'x',
      workspace_id: 'ws-1',
      kind: 'prompt',
      title: 'T',
      description: '',
      tag: null,
      variables: null,
      steps: null,
      content: null,
      system_instruction: null,
      context_file_ids: null,
      skill_ids: null,
      model: null,
      created_at: '',
      updated_at: '',
      created_by: null,
      usage_count: 0,
      is_favorite: false,
      published: true,
    };

    const prompt = rowToPrompt(row);

    expect(prompt.tag).toBeNull();
    expect(prompt.variables).toEqual([]);
    expect(prompt.content).toBe('');
    expect(prompt.contextFileIds).toEqual([]);
    expect(prompt.skillIds).toEqual([]);
    expect(prompt.createdBy).toBe('');
  });
});

describe('variable substitution logic', () => {
  it('replaces {{var}} placeholders with values', () => {
    let content = 'Hello {{name}}, your role is {{role}}.';
    const vars = [
      { name: 'name', value: 'Alice' },
      { name: 'role', value: 'Engineer' },
    ];
    for (const v of vars) {
      content = content.replace(new RegExp(`{{${v.name}}}`, 'g'), v.value);
    }
    expect(content).toBe('Hello Alice, your role is Engineer.');
  });

  it('replaces multiple occurrences of same variable', () => {
    let content = '{{x}} and {{x}}';
    content = content.replace(new RegExp(`{{x}}`, 'g'), 'replaced');
    expect(content).toBe('replaced and replaced');
  });

  it('leaves unmatched placeholders unchanged', () => {
    let content = 'Hello {{name}}';
    content = content.replace(new RegExp(`{{age}}`, 'g'), '30');
    expect(content).toBe('Hello {{name}}');
  });
});
