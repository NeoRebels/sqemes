// SQEM-412 — what a model returns as a draft's `content`, turned into the Markdown a person reads.
//
// ⛔ **This exists because `String(value)` on an object is `"[object Object]"`, and that string was
// SAVED, not just shown.** The starter-skill instruction describes the body as a shape — *Scope,
// Rules, Examples, Limits* — and a model may hand that back as a JSON object instead of one Markdown
// string. `generateStarterSkills` did `content: String(x.content)`, the wizard's preview showed
// `[object Object]`, and pressing Create wrote exactly that into the workspace. A UX tester
// (2026-09-15) hit it on the very first playbooks his account ever had.
//
// ⚠️ The conversion is deliberately **shape-agnostic**. Pinning it to those four keys would fix the
// case we saw and break on the next one the model invents; nothing about the prompt guarantees a
// particular object. The instruction now also says "one Markdown string" — this is the net under it.

/** A heading level deep enough to nest, shallow enough to stay readable. */
const headingFor = (depth: number) => '#'.repeat(Math.min(depth + 1, 6));

/**
 * `snake_case` / `camelCase` key → the words a person would write, title-cased per word the way
 * `extractVariables` labels a placeholder — the two are read side by side in the wizard.
 */
function keyToHeading(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function render(value: unknown, depth: number): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    // A list of strings is a bullet list; a list of objects keeps its structure below the bullets.
    return value
      .map(item => (typeof item === 'object' && item !== null
        ? render(item, depth)
        : `- ${render(item, depth)}`))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => {
        const body = render(val, depth + 1);
        return body ? `${headingFor(depth)} ${keyToHeading(key)}\n\n${body}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/**
 * The draft body as Markdown, or `''` when there is nothing usable.
 *
 * An empty result is the caller's signal to DROP the draft: a playbook whose body is empty is worse
 * than one fewer playbook, and it is what the old code shipped as `"[object Object]"`.
 */
export function contentToMarkdown(value: unknown): string {
  return render(value, 1).trim();
}
