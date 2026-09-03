// SQEM-325 — the Persona Wizard.
//
// Two fields and a button: what the role is, and which templates it may reach for. One generation
// pass writes the role prose **and** a condition per attached template.
//
// ⛔ **The conditions are the point, not the prose.** A person can write "you work in sales" in
// twenty seconds; deciding, per template, the situation in which it applies is the tedious part —
// and it is what lazy loading depends on. A wizard that produced only prose and left every
// condition empty would have created a persona that loads everything or nothing, which is exactly
// what personas exist to avoid.
//
// ⚠️ **Cloud-only, and NOT because of the model access.** `runAuthoringAI` works on self-host over
// BYOK; the enhance buttons in the persona editor prove it. The wizard is the guided onboarding
// surface of Cloud, which is a product decision (SQEM-170), so it is stated here rather than left
// to look like a technical limit somebody should "fix".
//
// ⚠️ Deliberately **no brand-profile requirement**, unlike `TemplateWizardModal`. That one writes in
// the brand's voice and is useless without it. A persona describes how a role works, not how the
// company sounds — demanding a brand first would be a gate with nothing behind it.
import { useMemo, useState } from 'react';
import { Sparkles, Loader2, X, Search, AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import SegmentedTabs from './ui/SegmentedTabs';
import TemplatePickRow from './ui/TemplatePickRow';
import Button from './ui/Button';
import { usePrompts, useWorkspace, useUI } from '../store';
import { runAuthoringAI, authoringModelId } from '../lib/authoringAI';
import { createPersona } from '../lib/api/personas';
import type { Persona, PromptKind } from '../types';

/** Defensively parse a JSON object out of an LLM response (tolerates fences and surrounding prose). */
function parseJsonObject(raw: string): any {
  let text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  try { return JSON.parse(text); } catch { return {}; }
}

export default function PersonaWizardModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (persona: Persona) => void;
}) {
  const { prompts } = usePrompts();
  const { workspace, currentUser } = useWorkspace();
  const { showToast } = useUI();

  const [goal, setGoal] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | PromptKind>('all');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prompts
      .filter(p => kind === 'all' || p.kind === kind)
      .filter(p => !q || p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [prompts, kind, search]);

  const pickedTemplates = useMemo(
    () => picked.map(id => prompts.find(p => p.id === id)).filter(Boolean) as typeof prompts,
    [picked, prompts],
  );

  const toggle = (id: string) =>
    setPicked(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));

  const reset = () => { setGoal(''); setPicked([]); setSearch(''); setKind('all'); setStage(''); };

  const handleGenerate = async () => {
    if (!goal.trim()) { showToast('Describe the role first.', 'error'); return; }
    setBusy(true);
    setStage(pickedTemplates.length ? 'Reading your templates' : 'Writing the role');
    try {
      // The model is given the templates it may route to, by index. Asking it to echo ids invites
      // invented ones; an index it can only get wrong within a range we control.
      const catalogue = pickedTemplates
        .map((t, i) => `${i}. [${t.kind}] ${t.title}${t.description ? ` — ${t.description}` : ''}`)
        .join('\n') || '(none)';

      const systemInstruction = `You design a PERSONA for an AI assistant: a working role that bundles several templates behind conditions saying which to load when.

Return ONLY a JSON object, no prose and no code fence:
{
  "title": "short role name, 1-3 words",
  "description": "1-2 sentences answering: for which task should someone pick this role? It is shown in a picker and is often all a person sees before choosing.",
  "content": "the role description in markdown, addressed to the assistant in the second person: who it is, how it works, what it asks for before acting, what it never does",
  "routes": [{ "index": 0, "condition": "when …" }]
}

Rules for "content":
- ⛔ Do NOT write a routing table, a list of the templates, or any "if X then load Y" line. The routing is assembled from "routes" afterwards, and writing it twice is how the two drift apart.
- Be specific to the described role. No filler about being helpful or professional.

Rules for "routes":
- One entry per template listed below, using its INDEX. Keep the given order.
- The condition completes "load this template when …". One short clause, naming the SITUATION.
- ⚠️ A template's own description is already used when no condition is given, so a condition that merely restates it is worthless. Write what this template means **for this persona specifically** — and if the description truly is the whole answer, return "" for that entry rather than padding it.`;

      setStage('Writing the role and its routes');
      const raw = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId: authoringModelId(workspace),
        systemInstruction,
        prompt: `What this persona should be:\n${goal.trim()}\n\nTemplates it may route to:\n${catalogue}`,
        temperature: 0.7,
      });

      const parsed = parseJsonObject(raw);
      const title = String(parsed.title || '').trim() || goal.trim().split(/\s+/).slice(0, 3).join(' ');
      const content = String(parsed.content || '').trim();
      if (!content) throw new Error('The model returned no role description. Try again, or describe the role in a little more detail.');

      // ⚠️ Routes are rebuilt from OUR list, not from the model's. A returned index outside the
      // range is dropped, and a template the model forgot still becomes a route — with an empty
      // condition, which now means "use the template's own description". Attaching what the person
      // chose is not the model's decision to reverse.
      const byIndex = new Map<number, string>();
      for (const r of Array.isArray(parsed.routes) ? parsed.routes : []) {
        const i = Number(r?.index);
        if (Number.isInteger(i) && i >= 0 && i < pickedTemplates.length) {
          byIndex.set(i, String(r?.condition ?? '').trim());
        }
      }

      setStage('Saving');
      const created = await createPersona(
        workspace.id,
        {
          title,
          description: String(parsed.description || '').trim(),
          content,
          routes: pickedTemplates.map((t, i) => ({
            templateId: t.id,
            templateTitle: t.title,
            templateKind: t.kind,
            condition: byIndex.get(i) ?? '',
            sortOrder: i,
          })),
          // SQEM-265 / EU AI Act Art. 50(2) — the same stamp a generated template carries. Without
          // it personas would be a second class of AI-produced object with no marking at all.
          aiGeneratedAt: new Date().toISOString(),
        },
        currentUser.id || null,
      );

      reset();
      onCreated(created);
    } catch (err: any) {
      showToast(err?.message || 'Could not generate the persona', 'error');
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} size="lg" className="flex flex-col max-h-[85vh]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-500" /> Persona Wizard
        </h2>
        {!busy && (
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <div>
          <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            What should this persona be?
          </label>
          <textarea
            value={goal}
            onChange={e => setGoal(e.target.value)}
            disabled={busy}
            rows={4}
            placeholder="A sales role that writes offers, proposes workshops and finds AI use cases for a customer. It always asks for the customer context first and never invents prices."
            className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all resize-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              Templates it may reach for
            </label>
            <span className="text-2xs text-slate-400">{picked.length} selected</span>
          </div>

          {prompts.length === 0 ? (
            <div className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
              This workspace has no templates yet. A persona without routes is only a role
              description — you can still create one and attach templates later.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    disabled={busy}
                    placeholder="Search templates..."
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500"
                  />
                </div>
                <SegmentedTabs<'all' | PromptKind>
                  value={kind}
                  onChange={setKind}
                  tabs={[
                    { value: 'all', label: 'All' },
                    { value: 'prompt', label: 'Prompts' },
                    { value: 'assistant', label: 'Assistants' },
                    { value: 'skill', label: 'Skills' },
                  ]}
                />
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {/* SQEM-330 — the same row as the attach picker in the editor, so the two
                    cannot drift. Multi-select here, act-on-click there; that is the only
                    difference, and it is the row's one prop. */}
                {visible.map(t => (
                  <TemplatePickRow
                    key={t.id}
                    template={t}
                    selected={picked.includes(t.id)}
                    disabled={busy}
                    onClick={() => toggle(t.id)}
                  />
                ))}
                {visible.length === 0 && (
                  <p className="text-xs text-slate-400 py-4 text-center">Nothing matches.</p>
                )}
              </div>
            </>
          )}
        </div>

        {picked.length === 0 && prompts.length > 0 && (
          <p className="text-2xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Without templates this persona can load nothing — it will be a role description only. You
            can attach them afterwards.
          </p>
        )}
      </div>

      <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 shrink-0">
        <span className="text-xs text-slate-400 dark:text-slate-500 min-h-[1rem]">
          {busy ? stage : ''}
        </span>
        <Button onClick={handleGenerate} loading={busy} disabled={busy || !goal.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate Persona
        </Button>
      </div>
    </Modal>
  );
}
