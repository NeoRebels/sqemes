import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkspace, useUI, usePrompts } from '../store';
import { authoringModelId, hasAuthoringAlternatives } from '../lib/authoringAI';
import { generateStarterLibrary, type TemplateDraft } from '../lib/wizardGeneration';
import { BrandProfileForm, EMPTY_BRAND_FORM, type BrandFormValue } from './BrandProfileForm';
import { brandIsComplete } from '../lib/brand';
import type { Prompt } from '../types';
import { TEMPLATE_CATEGORIES } from '../constants';
import { Wand2, Sparkles, Key, ChevronDown, ChevronUp, ArrowRight, Check, AlertCircle, Loader2 } from 'lucide-react';
import Checkbox from './ui/Checkbox';
import { describeAIError } from '../lib/aiErrors';

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  prompt: { label: 'Prompt', cls: 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20' },
  skill: { label: 'Skill', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' },
};

export interface WizardAction {
  label: string;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
}

interface WizardCreateStepProps {
  /** Called after templates are created, with how many — the wizard moves on and keeps the count for its ledger. */
  onComplete: (createdCount: number) => void;
  /** Jump to the AI-key step (the last one since SQEM-386). */
  onConnectKey: () => void;
  /** Reports this step's primary action so the wizard renders it in the footer (Next slot). */
  onActionChange: (action: WizardAction | null) => void;
  /**
   * SQEM-413 — lets this step own the footer's Back button while the review is open.
   * ⛔ Without it, Back leaves the whole step: the old way back to the brand form was a "← Edit brand"
   * link, and a UX tester read that as "edit colours and logo" and never clicked it.
   */
  onBackChange: (handler: (() => void) | null) => void;
}

const WizardCreateStep = ({ onComplete, onConnectKey, onActionChange, onBackChange }: WizardCreateStepProps) => {
  const { workspace, currentUser, updateWorkspace } = useWorkspace();
  const { showToast } = useUI();
  const { addPrompt } = usePrompts();

  // BYOK text model if one exists; otherwise null → route to Sqemes-funded credits.
  const modelId = authoringModelId(workspace);
  // AI is usable when there's a BYOK model OR Sqemes-funded AI is available (Cloud, keyless).
  const canUseAI = !!modelId || !!workspace.fundedAvailable;

  const [brand, setBrand] = useState<BrandFormValue>(EMPTY_BRAND_FORM);

  /**
   * SQEM-413 — which areas the first playbooks cover. The labels are the marketplace categories, so the
   * word a person picks here is the word the marketplace uses, and it becomes the playbook's tag.
   * ⚠️ Capped at three: a UX tester asked for two, and every extra area is two more drafts to read
   * before anything has been used once.
   */
  const [areas, setAreas] = useState<string[]>([]);
  const MAX_AREAS = 3;

  /**
   * SQEM-416 — three phases, not two. The areas used to sit at the bottom of the brand form, and the
   * primary button already said "Generate my starter playbooks" while the person was still typing
   * their website. Now the brand form ends in **Continue**, the areas get a screen of their own, and
   * "Generate" belongs to the screen that decides WHAT is generated (owner, after walking the wizard).
   *
   * ⚠️ These are phases inside the "Create playbooks" step, not wizard steps: the progress bar counts
   * steps, and it must not move while a person is still inside one.
   */
  const [phase, setPhase] = useState<'brand' | 'areas' | 'review'>('brand');
  const [generating, setGenerating] = useState(false);
  /**
   * SQEM-417 — which of the three generation calls have landed. The wizard used to show one disabled
   * button labelled "Generating…" for the whole wait; this is the same wait with the parts named.
   */
  const [sections, setSections] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<TemplateDraft[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  // SQEM-308 — the same predicate the rest of the product uses. This tested `brandName` and
  // `whatItDoes` and let `audience` through empty, which made onboarding stricter than the
  // marketplace and looser than the form's own required marks. Three answers to one question.
  const canGenerate = canUseAI && brandIsComplete(brand) && areas.length > 0;
  // SQEM-416 — the brand form's own gate. The areas are asked on the next screen, so leaving this one
  // asks only what this one shows.
  const canContinue = brandIsComplete(brand);

  const handleGenerate = async () => {
    if (!canUseAI || !canGenerate) return;
    setGenerating(true);
    setSections({});
    // SQEM-106 — persist the brand inputs as the workspace brand profile
    // (previously discarded after the wizard). Powers marketplace adaptation.
    updateWorkspace({
      brandProfile: {
        brandName: brand.brandName.trim(),
        whatItDoes: brand.whatItDoes.trim(),
        audience: brand.audience.trim(),
        website: brand.website.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
    try {
      const { drafts: result, failures } = await generateStarterLibrary(
        { brandName: brand.brandName.trim(), whatItDoes: brand.whatItDoes.trim(), audience: brand.audience.trim() },
        { workspaceId: workspace.id, modelId },
        areas,
        (label, ok) => setSections(prev => ({ ...prev, [label]: ok })),
      );
      if (result.length === 0) {
        // SQEM-200 — the two empty outcomes need different advice. A rejected key or exhausted
        // credits does not get better by retrying, so don't tell the user to try again for those.
        showToast(
          failures.length > 0
            ? `Couldn't generate your starter playbooks. ${describeAIError(failures[0], 'Try again in a moment.', { alternativesAvailable: hasAuthoringAlternatives(workspace) })}`
            : "The AI didn't return anything usable. Try again, or browse the Marketplace for ready-made playbooks.",
          'error',
        );
        return;
      }
      setDrafts(result);
      setSelected(new Set(result.map((_, i) => i)));
      setPhase('review');
      // Partial success is still success — but name what's missing instead of quietly shipping less.
      if (failures.length > 0) {
        showToast(
          `${failures.map(f => f.section).join(' and ')} couldn't be generated — you can add those later. ${failures[0].message}`,
          'info',
        );
      }
    } catch (err: any) {
      showToast(err.message || 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const updateDraft = (i: number, patch: Partial<TemplateDraft>) =>
    setDrafts(prev => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const toggle = (set: Set<number>, i: number) => {
    const n = new Set(set);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  };

  const handleCreate = async () => {
    const chosen = drafts.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await Promise.all(chosen.map(d => addPrompt({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        kind: d.kind,
        title: d.title,
        description: d.description,
        // SQEM-413 — the chosen area travels with the playbook as its tag, so the grouping the person
        // saw in the review still exists in the Playbooks list. The brand voice belongs to no area.
        tag: d.area ?? null,
        variables: d.variables,
        content: d.content,
        contextFileIds: [],
        // SQEM-265 — the wizard writes whole templates and the person only picks which to keep.
        // That is generation under EU AI Act Art. 50(2), unlike the editor's Enhance, which works
        // on text the person wrote and is covered by the editing exemption.
        aiGeneratedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.id,
        usageCount: 0,
        published: true,
      } as Prompt)));
      showToast(`Created ${chosen.length} playbook${chosen.length > 1 ? 's' : ''}`, 'success');
      // SQEM-386 — no navigation here any more: the wizard continues to the extension step and lands
      // on Templates from its final "Done", so the person sees what was generated once they leave.
      onComplete(chosen.length);
    } catch (err: any) {
      showToast(err.message || 'Failed to create playbooks', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Report the primary action to the wizard footer (sits next to "Skip for now").
  // A ref keeps the click bound to the latest handler without re-reporting every render.
  const actionRef = useRef<() => void>(() => {});
  actionRef.current = phase === 'brand' ? () => setPhase('areas') : phase === 'areas' ? handleGenerate : handleCreate;
  const runAction = useCallback(() => actionRef.current(), []);

  useEffect(() => {
    onActionChange(
      phase === 'brand'
        ? { label: 'Continue', onClick: runAction, disabled: !canContinue, loading: false }
        : phase === 'areas'
          ? { label: generating ? 'Generating your starter playbooks…' : 'Generate my starter playbooks', onClick: runAction, disabled: !canGenerate || generating, loading: generating }
          : { label: saving ? 'Creating…' : `Create ${selected.size} playbook${selected.size === 1 ? '' : 's'}`, onClick: runAction, disabled: selected.size === 0 || saving, loading: saving },
    );
  }, [phase, generating, canContinue, canGenerate, saving, selected.size, runAction, onActionChange]);

  useEffect(() => () => onActionChange(null), [onActionChange]);

  // SQEM-413 — Back belongs to this step while it has somewhere of its own to go; on the first phase
  // it belongs to the wizard again, which is why the handler is cleared rather than left pointing at a
  // dead phase. SQEM-416 — two rungs now: review → areas → brand.
  useEffect(() => {
    onBackChange(
      phase === 'review' ? () => setPhase('areas')
        : phase === 'areas' ? () => setPhase('brand')
          : null,
    );
    return () => onBackChange(null);
  }, [phase, onBackChange]);

  // ---- Review phase ----
  if (phase === 'review') {
    return (
      <div>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Review your starter playbooks</h3>
            {/* SQEM-386 — say whose they are: a tester did not realise these were generated for HIM. */}
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Generated for {brand.brandName.trim() || 'your brand'} from what you told us. <span className="font-semibold text-slate-600 dark:text-slate-300">Start easy, customize later</span> — these are starting points; edit, delete or add playbooks any time.</p>
          </div>
        </div>

        {/* SQEM-413 — grouped by the area the person chose, brand voice first: a flat list of eight made
            a tester ask what one of them was for. `undefined` area = the brand voice, which has none. */}
        <div className="space-y-4 max-h-[42vh] overflow-y-auto pr-1">
          {[{ heading: 'Brand', area: undefined as string | undefined }, ...areas.map(a => ({ heading: a, area: a as string | undefined }))]
            .map(group => ({ ...group, items: drafts.map((d, i) => ({ d, i })).filter(({ d }) => d.area === group.area) }))
            .filter(group => group.items.length > 0)
            .map(group => (
            <div key={group.heading} className="space-y-2">
              {/* SQEM-417 — the heading carries the count: "Marketing 2" answers "what did I just get?"
                  before anything is read. */}
              <div className="flex items-center gap-2">
                <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider">{group.heading}</p>
                <span className="text-2xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-md px-1.5 py-0.5">{group.items.length}</span>
                <span className="h-px flex-1 bg-slate-100 dark:bg-slate-700" />
              </div>
              {group.items.map(({ d, i }) => {
            const badge = KIND_BADGE[d.kind] ?? KIND_BADGE.prompt;
            const isOpen = expanded.has(i);
            const isSel = selected.has(i);
            return (
              <div
                key={i}
                style={{ '--i': i } as React.CSSProperties}
                className={`animate-stagger border rounded-2xl p-3.5 transition-all ${isSel
                  ? 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm'
                  : 'border-slate-100 dark:border-slate-700 opacity-60'}`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox checked={isSel} onChange={() => setSelected(s => toggle(s, i))} className="mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-2xs font-bold px-2 py-0.5 rounded-md ${badge.cls}`}>{badge.label}</span>
                      {d.variables.length > 0 && <span className="text-2xs text-slate-400">{d.variables.length} variable{d.variables.length > 1 ? 's' : ''}</span>}
                    </div>
                    <input
                      value={d.title}
                      onChange={e => updateDraft(i, { title: e.target.value })}
                      className="w-full text-sm font-semibold text-slate-900 dark:text-slate-100 bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-slate-700/50 rounded px-1 -mx-1"
                    />
                    <input
                      value={d.description}
                      onChange={e => updateDraft(i, { description: e.target.value })}
                      placeholder="Description"
                      className="w-full text-xs text-slate-500 dark:text-slate-400 bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-slate-700/50 rounded px-1 -mx-1 mt-0.5"
                    />
                    {d.content && (
                      <>
                        <button onClick={() => setExpanded(s => toggle(s, i))} className="inline-flex items-center gap-1 text-2xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-1.5">
                          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} {isOpen ? 'Hide' : 'Preview'} content
                        </button>
                        {isOpen && (
                          <pre className="mt-2 text-2xs font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{d.content}</pre>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
              })}
            </div>
          ))}
        </div>

        <div className="mt-4">
          {/* SQEM-413 — no "← Edit brand" link here any more; the footer's Back leads to the brand form. */}
        </div>
      </div>
    );
  }

  // ---- Generating (SQEM-417) ----
  //
  // The wait used to be a disabled footer button that said "Generating your starter playbooks…" over
  // an unchanged form. It is the moment three UX testers called magic, and it looked like nothing was
  // happening. The three calls go out together, so the rows tick off in whatever order they land —
  // no invented progress bar, and a failed section says so instead of spinning forever.
  if (generating) {
    const rows = [
      { label: 'brand voice', text: 'Reading your brand' },
      { label: 'prompts', text: 'Writing one prompt per area' },
      { label: 'skills', text: 'Writing one skill per area' },
    ];
    return (
      <div>
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Writing your starter playbooks</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              For {brand.brandName.trim() || 'your brand'} — {areas.join(', ')}. This takes a few seconds.
            </p>
          </div>
        </div>

        <ul className="space-y-2 mb-5">
          {rows.map((r, i) => {
            const state = sections[r.label];
            return (
              <li key={r.label} style={{ '--i': i } as React.CSSProperties} className="animate-stagger flex items-center gap-2.5 text-sm">
                {state === true
                  ? <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  : state === false
                    ? <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    : <Loader2 className="w-4 h-4 text-brand-500 shrink-0 animate-spin" />}
                <span className={state === undefined ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-200'}>
                  {r.text}
                </span>
              </li>
            );
          })}
        </ul>

        {/* One card per playbook that is coming: brand voice plus a prompt and a skill per area. */}
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 1 + areas.length * 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-100 dark:border-slate-700 p-3.5 animate-pulse">
              <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-700" />
              <div className="h-2.5 w-2/3 rounded bg-slate-100/70 dark:bg-slate-700/60 mt-2.5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- Areas phase (SQEM-416) ----
  //
  // The areas decide WHAT gets generated (SQEM-413): a UX tester read a generated FAQ module and asked
  // what it was supposed to do for him — nothing had asked him what he works on. They used to sit at
  // the bottom of the brand form; on their own screen the question is the only thing being asked, and
  // the button under it is the one that generates.
  if (phase === 'areas') {
    return (
      <div>
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            {/* The labels are the marketplace categories, so the word picked here is the word met
                again when browsing — and it becomes the playbook's tag. */}
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Which areas should your first playbooks cover?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              You get your brand voice plus one prompt and one skill for each area — written for {brand.brandName.trim() || 'your brand'}.
            </p>
          </div>
        </div>

        {/* SQEM-416 — the key gate belongs to the screen that generates, not to the brand form two
            screens earlier, where it warned about something the person had not asked for yet. */}
        {!canUseAI && (
          <button
            onClick={onConnectKey}
            className="w-full flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-left hover:bg-amber-100/70 dark:hover:bg-amber-900/30 transition-colors"
          >
            <Key className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="flex-1 text-xs text-amber-700 dark:text-amber-300">A provider key is needed to generate playbooks here — that is step 3. You can add it first and come back.</span>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300 shrink-0 inline-flex items-center gap-1">Go to step 3 <ArrowRight className="w-3.5 h-3.5" /></span>
          </button>
        )}

        <div className="flex flex-wrap gap-2">
          {TEMPLATE_CATEGORIES.map(cat => {
            const on = areas.includes(cat);
            const full = !on && areas.length >= MAX_AREAS;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => setAreas(prev => (prev.includes(cat) ? prev.filter(a => a !== cat) : [...prev, cat]))}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  on
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : full
                      ? 'border-slate-100 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                      : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
          {areas.length === 0
            ? 'Pick one to three — two is a good start.'
            : `${areas.length} of ${MAX_AREAS} — start easy, customize later.`}
        </p>
      </div>
    );
  }

  // ---- Brand phase ----
  return (
    <div>
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
          <Wand2 className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Create your starter playbooks</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Your website is enough — AI drafts your brand voice plus one prompt and one skill for each area you pick.</p>
        </div>
      </div>

      {/* Round 2 (owner): the website field alone, the manual fields behind a link — the modal was crowded. */}
      <BrandProfileForm value={brand} onChange={patch => setBrand(b => ({ ...b, ...patch }))} collapsible />
    </div>
  );
};

export default WizardCreateStep;
