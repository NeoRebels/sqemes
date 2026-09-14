import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-406 — a person reads "use", the code says "applied".
 *
 * In a UX test (2026-09-14) "Apply skill" was read as "activate" — as if the skill were switched on
 * for everyone, or shared live. Nothing like that happens: the skill joins THIS chat's context. The
 * Chat header already lists what is in effect under "Using:", so the button, its explanation and the
 * toasts say the same word. ⚠️ "applied" stays the code's term (`applied_skill_ids`, SQEM-371); only
 * what a person reads changed. These assertions read the rendered strings, not the comments.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// ⚠️ Line comments BEFORE block comments (see assistantsBecomeSkills.test.ts for why).
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-406 — "Use skill", one word from the button to the "Using:" strip', () => {
  const modal = code(read('components/TemplateLaunchModal.tsx'));
  const chat = code(read('pages/Chat.tsx'));

  it('the launch button says "Use skill", never "Apply skill"', () => {
    expect(modal).toContain("'Use skill'");
    expect(modal).not.toMatch(/Apply skill/i);
  });

  it('the explanation says what using it does, in the same word', () => {
    expect(modal).toContain('Using it adds this knowledge to this chat');
    expect(modal).not.toContain('Applying it adds');
  });

  it('the Chat header still calls the strip "Using:" — the word the button borrows', () => {
    expect(chat).toContain('Using:');
  });

  it('no toast tells a person something was "applied"', () => {
    expect(chat).not.toMatch(/showToast\([^)]*applied/i);
    expect(chat).toContain('in this chat`');
  });
});
