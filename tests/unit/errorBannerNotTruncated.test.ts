import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-465 — the chat error banner must never clip a provider's message.
 *
 * ⛔ **This was found through a customer, not through a test.** Dennis Fechner sent a screenshot on
 * 2026-09-22 showing:
 *
 *     Claude API error (400): {"type":"error","error":{"type":"invalid_request_error",
 *     "message":"mcp_servers: M…
 *
 * The banner was `<span className="truncate">`, so the sentence ended there. The half that was cut
 * is the half that says what is wrong — SQEM-466 had no diagnosis for that reason alone.
 *
 * ⭐ **The rule already existed; it just had never been applied to CSS.** `lib/aiErrors.ts` spends a
 * page on it: *"The fix is emphatically not to hide the provider's reason. That was the other
 * failure, and it cost hours."* A principle written for error-handling code failed in a class
 * attribute, where nobody looked for it.
 *
 * ⚠️ What this file does NOT claim: that no `truncate` may appear in `Chat.tsx`. Session titles in
 * the sidebar are truncated on purpose. The assertion is scoped to the error banner.
 */
const ROOT = resolve(__dirname, '../../');
const chat = readFileSync(resolve(ROOT, 'pages/Chat.tsx'), 'utf8');

/** The JSX comment marked `Error` down to the one marked `Input area`: both branches. */
function errorBanner(): string {
  const start = chat.indexOf('{/* Error */}');
  const end = chat.indexOf('{/* Input area */}', start);
  expect(start, 'the Error block marker moved or was renamed').toBeGreaterThan(-1);
  expect(end, 'the Input area marker moved or was renamed').toBeGreaterThan(start);
  return chat.slice(start, end);
}

describe('SQEM-465 — a provider error is shown in full', () => {
  it('⛔ the error banner does not truncate', () => {
    expect(
      errorBanner(),
      'A provider message clipped to one line hides the reason — that is what SQEM-465 fixed. ' +
      'If the banner grows too tall, cap its height and let it scroll; do not bring back `truncate`.',
    ).not.toMatch(/className="[^"]*\btruncate\b/);
  });

  it('⛔ it wraps, including on JSON with no spaces to break at', () => {
    // A provider error is usually a JSON blob. Without `break-words` it overflows its box instead
    // of wrapping, which looks like a layout bug and hides the tail just as effectively.
    expect(errorBanner()).toMatch(/className="[^"]*\bbreak-words\b/);
  });

  it('⚠️ the icon sits beside the first line, not centred against a paragraph', () => {
    expect(errorBanner()).toMatch(/\bitems-start\b/);
  });

  it('⭐ the out-of-credits branch keeps its own shape — it was already right', () => {
    // It never truncated. The fix was not to rewrite both, only to make the other one agree.
    expect(errorBanner()).toMatch(/Upgrade or add a key/);
  });
});
