import { describe, it, expect } from 'vitest';
import { contentToMarkdown } from '../../lib/draftContent';

// SQEM-412 — the conversion itself, away from the generator: it is the piece that decides whether a
// person reads Markdown or "[object Object]", and it must stay shape-agnostic.

describe('contentToMarkdown', () => {
  it('leaves a string body alone (the normal case)', () => {
    expect(contentToMarkdown('## Scope\n\nCustomer replies.')).toBe('## Scope\n\nCustomer replies.');
  });

  it('turns an object into headings and keeps the order the model used', () => {
    const md = contentToMarkdown({ scope: 'When replying.', rules: ['Greet by name', 'No dates'] });
    expect(md).toBe('## Scope\n\nWhen replying.\n\n## Rules\n\n- Greet by name\n- No dates');
  });

  it('reads a key the way a person would write it', () => {
    expect(contentToMarkdown({ output_format: 'Bullets' })).toContain('## Output Format');
    expect(contentToMarkdown({ outputFormat: 'Bullets' })).toContain('## Output Format');
  });

  it('nests deeper objects instead of flattening them', () => {
    const md = contentToMarkdown({ examples: { before: 'Hi.', after: 'Good morning.' } });
    expect(md).toContain('## Examples');
    expect(md).toContain('### Before');
    expect(md).toContain('Good morning.');
  });

  it('is empty when there is nothing to read — the caller drops the draft', () => {
    for (const value of [null, undefined, {}, [], '', '   ', { a: '' }]) {
      expect(contentToMarkdown(value)).toBe('');
    }
  });

  it('never produces the string that started this', () => {
    expect(contentToMarkdown({ a: { b: ['c'] } })).not.toContain('[object Object]');
  });
});
