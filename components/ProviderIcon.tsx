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
  sqemes: sqemesSrc, // SQEM-082 — the funded "Sqemes AI" model option
};

interface Props {
  provider: string;
  className?: string;
}

export function ProviderIcon({ provider, className = 'w-4 h-4' }: Props) {
  const src = PROVIDER_ICONS[provider];

  if (src) {
    return <img src={src} className={className} alt={provider} />;
  }

  return null;
}
