import type { AssistantBrandConfig, ToneLevel } from '../types';

export const TONE_LABELS: Record<ToneLevel, string> = {
  1: 'Very formal and professional',
  2: 'Formal',
  3: 'Balanced — professional but approachable',
  4: 'Casual and conversational',
  5: 'Very casual and friendly',
};

export function compileBrandVoice(config: AssistantBrandConfig): string {
  const lines: string[] = [];

  const context = config.brandContext.trim();
  if (context) {
    lines.push(context);
    lines.push('');
  }

  lines.push(`Tone: ${TONE_LABELS[config.tone]}.`);

  const examples = config.examples.filter(e => e.input.trim() || e.output.trim());
  if (examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    examples.forEach(ex => {
      if (ex.input.trim()) lines.push(`User: ${ex.input.trim()}`);
      if (ex.output.trim()) lines.push(`Output: ${ex.output.trim()}`);
    });
  }

  return lines.join('\n');
}

// The full assistant system instruction = compiled brand voice + the content body.
// This is what every consumer (in-app launch, MCP, extension) uses, so folding
// `content` in here means none of them drop it.
export function compileAssistantInstruction(
  config: AssistantBrandConfig | null | undefined,
  content: string | null | undefined,
): string {
  const brand = config ? compileBrandVoice(config).trim() : '';
  const body = (content ?? '').trim();
  return [brand, body].filter(Boolean).join('\n\n');
}

export function defaultBrandConfig(): AssistantBrandConfig {
  return { tone: 3, brandContext: '', examples: [] };
}
