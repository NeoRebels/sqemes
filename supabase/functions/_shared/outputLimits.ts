/**
 * SQEM-616 — how much one chat round may write, per provider.
 *
 * ⛔ **A tool call is output too.** To change one product in a 17 KB list the model writes the whole
 * file as the `upload_file` argument, and a round that may write less than that cuts the call off
 * mid-JSON (2026-10-28, Claude at 8,192). So every branch decides its limit HERE, on
 * purpose — `null` means "send nothing, the provider's default is the better choice", never "forgot".
 * A call that still does not fit is caught by `runToolCall` (`isTruncatedArgs`), for every provider.
 *
 * Values checked against the providers' own documentation on 2026-10-28:
 * | provider | documented maximum | why this value |
 * |---|---|---|
 * | claude | 128K per model; ABOVE it → 400 | 32,000 — well inside every model, and a round cannot write more in the provider timeout anyway |
 * | openai | 128K (`max_output_tokens`; reasoning counts too) | 64,000 — leaves reasoning room, far below the cap |
 * | gemini | 65,536 (`maxOutputTokens`) for every offered text model | the documented maximum |
 * | deepseek | 393,216; DEFAULT ONLY 8K without thinking | 64,000 — the default was the gap |
 * | grok | no cap; default 128,000 | null — the default already suffices |
 * | mistral | no separate cap; `max_tokens` counts against the context window → 400 when prompt + value exceed it | null — a fixed value risks the 400 on long chats |
 * | openrouter | depends on the routed model | null — no single safe value exists |
 *
 * Pure, no imports: unit-tested (`tests/unit/truncatedToolCalls.test.ts`).
 */
export const OUTPUT_LIMIT = {
  claude: 32_000,
  openai: 64_000,
  gemini: 65_536,
  deepseek: 64_000,
  grok: null,
  mistral: null,
  openrouter: null,
} as const satisfies Record<string, number | null>;

export type LimitedProvider = keyof typeof OUTPUT_LIMIT;

/** The limit to send for this provider, or null to send none. Unknown providers send none. */
export function outputLimit(provider: string | undefined): number | null {
  return provider && provider in OUTPUT_LIMIT ? OUTPUT_LIMIT[provider as LimitedProvider] : null;
}
