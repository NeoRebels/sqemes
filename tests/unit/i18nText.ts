import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-604 — the UI texts for source-text tests. Since the German UI (SQEM-407) a pinned English
 * word lives in messages/en.json, not in the component: a test pins the KEY in the code and the WORD
 * here, so its intent ("the button says Use skill") survives the move.
 */
const read = (locale: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../messages/${locale}.json`), 'utf8')) as Record<string, string>;

export const en = read('en');
export const de = read('de');

/** The English text of a message; for a plural message, its `other` variant. */
function englishOf(key: string): string | undefined {
  const v = (en as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const match = (v[0] as { match?: Record<string, string> })?.match ?? {};
    return Object.entries(match).find(([k]) => k.endsWith('=other'))?.[1] ?? Object.values(match)[0];
  }
  return undefined;
}

/**
 * SQEM-610 — a source file with every `m.key(…)` call replaced by its English text, for tests that pin
 * WHERE a sentence stands in a component (an order, a branch, a neighbour) rather than one word. In
 * JSX (`{m.key()}`) the call becomes the plain text; anywhere else (`title: m.key(),`) a quoted string —
 * the shapes the source had before the German UI, so those assertions keep their meaning.
 * Placeholders stay as written in the message (`{count} playbooks ready`).
 */
export function withEnglish(src: string): string {
  const call = String.raw`m\.(\w+)\((?:[^()]|\([^()]*\))*\)`;
  return src
    .replace(new RegExp(String.raw`\{` + call + String.raw`\}`, 'g'), (whole, key) => englishOf(key) ?? whole)
    .replace(new RegExp(call, 'g'), (whole, key) => {
      const text = englishOf(key);
      return text === undefined ? whole : `'${text.replace(/'/g, "\\'")}'`;
    })
    // a message passed as a function (`title: m.key,`) — called at render, so it reads like a string here
    .replace(/\bm\.(\w+)\b(?!\()/g, (whole, key) => {
      const text = englishOf(key);
      return text === undefined ? whole : `'${text.replace(/'/g, "\\'")}'`;
    });
}
