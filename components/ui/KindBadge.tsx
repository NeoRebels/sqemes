import React from 'react';
import { PenTool, Bot, Wand2 } from 'lucide-react';
import type { PromptKind } from '../../types';

// SQEM-050 — the template "kind" pill (Prompt / Assistant / Skill) with icon.
// Shared by the Templates page cards and the Chat template modal so they look
// identical.

// ⛔ SQEM-307 — the violet here is **not** the accent-drift that ticket removed elsewhere. It marks
// the *assistant* kind, against prompt=brand and skill=emerald. Converting it to brand would make two
// of the three kinds identical, which is the one thing this badge exists to prevent.
//
// ⚠️ It is nonetheless a weak distinction: brand `#9333ea` and violet `#7c3aed` read as one colour to
// most eyes. The fix is a *different* colour for assistant, not brand — a design decision, open.
const CONFIG: Record<PromptKind, { label: string; Icon: typeof PenTool; className: string }> = {
  prompt: { label: 'Prompt', Icon: PenTool, className: 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' },
  assistant: { label: 'Assistant', Icon: Bot, className: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300' },
  skill: { label: 'Skill', Icon: Wand2, className: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' },
};

export default function KindBadge({ kind }: { kind: PromptKind }) {
  const { label, Icon, className } = CONFIG[kind];
  return (
    <span className={`text-2xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1 shrink-0 ${className}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}
