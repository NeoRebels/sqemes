/**
 * SQEM-557 — the AI tools Start links to. Plain links into each vendor's own chat: the playbooks reach
 * them through the extension or MCP, not through anything on this list. Pure data, so it is testable
 * without the store.
 *
 * `mono` marks logos drawn in a single colour (`currentColor`): inside an `<img>` that resolves to
 * black, so they are inverted in dark mode. The coloured ones stay as they are.
 *
 * Deliberately fixed, not per workspace.
 */
/** `short` is the visible label when the full name would push the row onto a second line. */
export type AiTool = { id: string; name: string; url: string; icon: string; mono?: boolean; short?: string };

export const AI_TOOLS: AiTool[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'openai', mono: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', icon: 'claude' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', icon: 'gemini' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/', icon: 'grok', mono: true },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', icon: 'perplexity', mono: true },
  { id: 'mistral', name: 'Mistral', url: 'https://chat.mistral.ai/', icon: 'mistral' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: 'deepseek' },
  { id: 'copilot', name: 'Microsoft Copilot', short: 'Copilot', url: 'https://copilot.microsoft.com/', icon: 'copilot' },
];
