import React from 'react';
import geminiSrc from '../assets/gemini-color.svg';
import openaiSrc from '../assets/openai.svg';
import claudeSrc from '../assets/claude-color.svg';
import deepseekSrc from '../assets/deepseek-color.svg';
import mistralSrc from '../assets/mistral-color.svg';
import openrouterSrc from '../assets/openrouter.svg';
import ollamaSrc from '../assets/ollama.svg';
import grokSrc from '../assets/grok.svg';
import perplexitySrc from '../assets/perplexity.svg';
import copilotSrc from '../assets/copilot-color.svg';
import claudecodeSrc from '../assets/claudecode.svg';
import codexSrc from '../assets/codex.svg';
import cursorSrc from '../assets/cursor.svg';
import sqemesSrc from '../assets/sqemes-icon.svg';

const PROVIDER_ICONS: Record<string, string> = {
  gemini: geminiSrc,
  openai: openaiSrc,
  claude: claudeSrc,
  deepseek: deepseekSrc,
  mistral: mistralSrc,
  openrouter: openrouterSrc,
  ollama: ollamaSrc,
  grok: grokSrc,
  perplexity: perplexitySrc,
  copilot: copilotSrc, // SQEM-557 — Start quick links only; not an AI provider of ours
  // SQEM-554 (c) — MCP client tabs in Settings and the setup wizard; MCP clients, not AI providers.
  claudecode: claudecodeSrc,
  codex: codexSrc,
  cursor: cursorSrc,
  sqemes: sqemesSrc, // SQEM-082 — the funded "Sqemes AI" model option
};

interface Props {
  provider: string;
  className?: string;
  /** SQEM-557 — '' when the icon sits next to its own visible name (decorative). */
  alt?: string;
}

export function ProviderIcon({ provider, className = 'w-4 h-4', alt = provider }: Props) {
  const src = PROVIDER_ICONS[provider];

  if (src) {
    return <img src={src} className={className} alt={alt} />;
  }

  return null;
}
