import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SQEM-550 (e) — Chat in redesign C's look. Still full screen with its own session list;
 * no new functions.
 */
const src = readFileSync(join(resolve(__dirname, '../..'), 'pages/Chat.tsx'), 'utf8');

describe('SQEM-550 (e) — Chat', () => {
  it('the composer is a raised card on the page', () => {
    expect(src).toMatch(/<div className="max-w-3xl mx-auto rounded-3xl border border-line bg-surface-raised shadow-raised p-3 md:p-4">/);
    expect(src).toMatch(/aria-label="Send message"[^>]*className="p-3 bg-accent-strong/);
  });

  it('a skill pill wears the skill kind colour, the persona pill the accent (SQEM-547: kind ≠ status)', () => {
    expect(src).toMatch(/rounded-full text-skill bg-skill-soft/);
    expect(src).toMatch(/rounded-full text-accent bg-accent-soft/);
    expect(src).not.toMatch(/text-emerald-700 dark:text-emerald-300 bg-emerald-50/);
  });

  it('assistant avatar, answer card, empty state and panels use the tokens', () => {
    expect(src).toMatch(/rounded-control bg-accent-strong flex items-center justify-center shrink-0 mt-1/);
    expect(src).toMatch(/bg-surface-raised px-5 py-4 rounded-card rounded-tl-md shadow-rest border border-line/);
    expect(src).toMatch(/<h2 className="font-display[^"]*">Start a conversation<\/h2>/);
    expect(src).toMatch(/md:w-\[300px\] bg-surface-sunken dark:bg-surface-raised border-r border-line/);
  });

  it('⛔ still full screen with its own session list (not in the shell)', () => {
    expect(readFileSync(join(resolve(__dirname, '../..'), 'App.tsx'), 'utf8')).toMatch(/<Route path="\/chat" element=\{<Chat \/>\} \/>/);
    expect(src).toMatch(/label="Back to Start"/);
  });
});
