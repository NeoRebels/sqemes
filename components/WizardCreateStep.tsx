import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace, useUI, usePrompts } from '../store';
import { firstTextModelId } from '../lib/authoringAI';
import { generateStarterLibrary, type TemplateDraft } from '../lib/wizardGeneration';
import { BrandProfileForm, EMPTY_BRAND_FORM, type BrandFormValue } from './BrandProfileForm';
import type { Prompt } from '../types';
import { Wand2, Sparkles, Key, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  assistant: { label: 'Assistant', cls: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20' },
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
  /** Called after templates are created so the wizard can complete. */
  onComplete: () => void;
  /** Jump back to the provider-key step (step 1). */
  onConnectKey: () => void;
  /** Reports this step's primary action so the wizard renders it in the footer (Next slot). */
  onActionChange: (action: WizardAction | null) => void;
}

const WizardCreateStep = ({ onComplete, onConnectKey, onActionChange }: WizardCreateStepProps) => {
  const { workspace, currentUser, updateWorkspace } = useWorkspace();
  const { showToast } = useUI();
  const { addPrompt } = usePrompts();
  const navigate = useNavigate();

  // BYOK text model if one exists; otherwise null → route to Sqemes-funded credits.
  const modelId = firstTextModelId(workspace.apiKeys);
  // AI is usable when there's a BYOK model OR Sqemes-funded AI is available (Cloud, keyless).
  const canUseAI = !!modelId || !!workspace.fundedAvailable;

  const [brand, setBrand] = useState<BrandFormValue>(EMPTY_BRAND_FORM);

  const [phase, setPhase] = useState<'form' | 'review'>('form');
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<TemplateDraft[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const canGenerate = canUseAI && brand.brandName.trim().length > 0 && brand.whatItDoes.trim().length > 0;

  const handleGenerate = async () => {
    if (!canUseAI || !canGenerate) return;
    setGenerating(true);
    // SQEM-106 — persist the brand inputs as the workspace brand profile
    // (previously discarded after the wizard). Powers marketplace adaptation.
    updateWorkspace({
      brandProfile: {
        brandName: brand.brandName.trim(),
        whatItDoes: brand.whatItDoes.trim(),
        audience: brand.audience.trim(),
        tone: brand.tone,
        useCase: brand.useCase.trim(),
        website: brand.website.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
    try {
      const result = await generateStarterLibrary(
        { brandName: brand.brandName.trim(), whatItDoes: brand.whatItDoes.trim(), audience: brand.audience.trim(), tone: brand.tone, useCase: brand.useCase.trim() },
        { workspaceId: workspace.id, modelId },
      );
      if (result.length === 0) {
        showToast('Generation returned nothing — please try again.', 'error');
        return;
      }
      setDrafts(result);
      setSelected(new Set(result.map((_, i) => i)));
      setPhase('review');
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
        tag: null,
        variables: d.variables,
        content: d.content,
        systemInstruction: d.systemInstruction,
        brandConfig: d.brandConfig,
        contextFileIds: [],
        skillIds: [],
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.id,
        usageCount: 0,
        published: true,
      } as Prompt)));
      showToast(`Created ${chosen.length} template${chosen.length > 1 ? 's' : ''}`, 'success');
      // Land on Templates so the user immediately sees what was generated.
      navigate('/templates');
      onComplete();
    } catch (err: any) {
      showToast(err.message || 'Failed to create templates', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Report the primary action to the wizard footer (sits next to "Skip for now").
  // A ref keeps the click bound to the latest handler without re-reporting every render.
  const actionRef = useRef<() => void>(() => {});
  actionRef.current = phase === 'form' ? handleGenerate : handleCreate;
  const runAction = useCallback(() => actionRef.current(), []);

  useEffect(() => {
    onActionChange(
      phase === 'form'
        ? { label: generating ? 'Generating your library…' : 'Generate library', onClick: runAction, disabled: !canGenerate || generating, loading: generating }
        : { label: saving ? 'Creating…' : `Create ${selected.size} template${selected.size === 1 ? '' : 's'}`, onClick: runAction, disabled: selected.size === 0 || saving, loading: saving },
    );
  }, [phase, generating, canGenerate, saving, selected.size, runAction, onActionChange]);

  useEffect(() => () => onActionChange(null), [onActionChange]);

  // ---- Review phase ----
  if (phase === 'review') {
    return (
      <div>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Review your starter templates</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Edit titles and descriptions, untick anything you don't want, then create them.</p>
          </div>
        </div>

        <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
          {drafts.map((d, i) => {
            const badge = KIND_BADGE[d.kind] ?? KIND_BADGE.prompt;
            const isOpen = expanded.has(i);
            const isSel = selected.has(i);
            return (
              <div key={i} className={`border rounded-xl p-3 transition-colors ${isSel ? 'border-slate-200 dark:border-slate-600' : 'border-slate-100 dark:border-slate-700 opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={isSel} onChange={() => setSelected(s => toggle(s, i))} className="mt-1.5 w-4 h-4 accent-brand-600 shrink-0" />
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

        <div className="mt-4">
          <button onClick={() => setPhase('form')} className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">← Edit brand</button>
        </div>
      </div>
    );
  }

  // ---- Form phase ----
  return (
    <div>
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
          <Wand2 className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Create your starter templates</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Tell us about your brand and AI will generate a brand-voice assistant, starter prompts, and a skill — all editable before they're saved.</p>
        </div>
      </div>

      {!canUseAI && (
        <button
          onClick={onConnectKey}
          className="w-full flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-left hover:bg-amber-100/70 dark:hover:bg-amber-900/30 transition-colors"
        >
          <Key className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="flex-1 text-xs text-amber-700 dark:text-amber-300">A provider key is needed to generate templates.</span>
          <span className="text-xs font-bold text-amber-700 dark:text-amber-300 shrink-0 inline-flex items-center gap-1">Add a key <ArrowRight className="w-3.5 h-3.5" /></span>
        </button>
      )}

      <BrandProfileForm value={brand} onChange={patch => setBrand(b => ({ ...b, ...patch }))} />
    </div>
  );
};

export default WizardCreateStep;
