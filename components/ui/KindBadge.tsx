import React from 'react';
import { PenTool, Wand2 } from 'lucide-react';
import type { PromptKind } from '../../types';
import { KIND_HELP } from '../../constants';

// SQEM-050 — the template "kind" pill (Prompt / Skill) with icon.
// Shared by the Templates page cards and the Chat template modal so they look
// identical.

// SQEM-390 — two kinds. The violet assistant entry (SQEM-307 had kept it against the accent sweep,
// and noted that violet and brand read as one colour) went with the kind; the open design question
// it recorded is closed by having nothing left to distinguish.
const CONFIG: Record<PromptKind, { label: string; Icon: typeof PenTool; className: string }> = {
  prompt: { label: 'Prompt', Icon: PenTool, className: 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' },
  skill: { label: 'Skill', Icon: Wand2, className: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' },
};

/**
 * SQEM-384 — the pill explains itself on hover.
 *
 * `KIND_HELP` (SQEM-204) had been written for exactly this question — "what is a Skill?" — and was
 * shown in two places only: the empty state and the editor, i.e. before there is a card and after
 * the kind has been chosen. In a UX test (2026-09-08) a marketer looked at a card that said SKILL,
 * said "I can't do anything with that, I use Copilot", and asked for one or two sentences on hover.
 * That is what a native `title` gives, on every card at once, with no tooltip component.
 *
 * ⚠️ Known limits, accepted for now: `title` shows after ~1 s and not at all on touch. If the next
 * test round says that is not enough, the answer is a real tooltip, not a longer label.
 */
export default function KindBadge({ kind }: { kind: PromptKind }) {
  const { label, Icon, className } = CONFIG[kind];
  return (
    <span
      title={KIND_HELP[kind]}
      className={`text-2xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1 shrink-0 ${className}`}
    >
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}
