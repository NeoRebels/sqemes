import { useState } from 'react';
import { useWorkspace, useUI } from '../store';
import { firstTextModelId } from '../lib/authoringAI';
import { analyzeWebsite } from '../lib/wizardGeneration';
import { TONE_LABELS } from '../lib/compileBrandVoice';
import type { ToneLevel, BrandProfile } from '../types';
import { Loader2, Globe } from 'lucide-react';

// SQEM-106 — shared brand form used by both onboarding (WizardCreateStep) and
// Settings → Brand. Owns the "Analyze your website" prefill + the brand fields.
// Controlled via `value`/`onChange`; analyze reads the workspace AI config itself.
export interface BrandFormValue {
  brandName: string;
  whatItDoes: string;
  audience: string;
  useCase: string;
  tone: ToneLevel;
  website: string;
}

export const EMPTY_BRAND_FORM: BrandFormValue = {
  brandName: '', whatItDoes: '', audience: '', useCase: '', tone: 3, website: '',
};

export function brandFormFromProfile(p?: BrandProfile): BrandFormValue {
  return {
    brandName: p?.brandName ?? '',
    whatItDoes: p?.whatItDoes ?? '',
    audience: p?.audience ?? '',
    useCase: p?.useCase ?? '',
    tone: p?.tone ?? 3,
    website: p?.website ?? '',
  };
}

const inputCls =
  'w-full p-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500';
const labelCls = 'block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5';

export function BrandProfileForm({
  value,
  onChange,
  disabled = false,
}: {
  value: BrandFormValue;
  onChange: (patch: Partial<BrandFormValue>) => void;
  disabled?: boolean;
}) {
  const { workspace } = useWorkspace();
  const { showToast } = useUI();
  const modelId = firstTextModelId(workspace.apiKeys);
  const canUseAI = !!modelId || !!workspace.fundedAvailable;
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!canUseAI || !value.website.trim()) return;
    setAnalyzing(true);
    try {
      const fields = await analyzeWebsite(value.website.trim(), { workspaceId: workspace.id, modelId });
      const patch: Partial<BrandFormValue> = {};
      if (fields.brandName) patch.brandName = fields.brandName;
      if (fields.whatItDoes) patch.whatItDoes = fields.whatItDoes;
      if (fields.audience) patch.audience = fields.audience;
      if (fields.tone) patch.tone = fields.tone;
      onChange(patch);
      showToast('Filled in from your site — review and edit below.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not read that website. Fill the form in manually.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div>
      {/* Website URL — analyzes the homepage and fills the form */}
      <div className="mb-4">
        <label className={labelCls}>
          Analyze your website <span className="normal-case font-normal text-slate-400">(optional — fills the form)</span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={value.website}
            onChange={e => onChange({ website: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
            placeholder="https://yourbrand.com"
            disabled={disabled}
            className="flex-1 p-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400"
          />
          <button
            onClick={handleAnalyze}
            disabled={disabled || !canUseAI || !value.website.trim() || analyzing}
            className="shrink-0 px-4 py-3 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing…</> : <><Globe className="w-4 h-4" /> Analyze</>}
          </button>
        </div>
        {!canUseAI && (
          <p className="text-2xs text-slate-400 dark:text-slate-500 mt-1">Add a provider key or enable Sqemes AI to analyze a website.</p>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">or fill in manually</span>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="space-y-3">
        <div>
          <label className={labelCls}>Brand name</label>
          <input value={value.brandName} onChange={e => onChange({ brandName: e.target.value })} placeholder="Acme Inc." disabled={disabled} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>What does your brand do?</label>
          <input value={value.whatItDoes} onChange={e => onChange({ whatItDoes: e.target.value })} placeholder="One sentence — e.g. we run leadership workshops for tech teams" disabled={disabled} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Who is your audience?</label>
          <input value={value.audience} onChange={e => onChange({ audience: e.target.value })} placeholder="e.g. HR leaders at mid-size companies" disabled={disabled} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>
            What do you want to use AI for? <span className="normal-case font-normal text-slate-400">(optional)</span>
          </label>
          <input value={value.useCase} onChange={e => onChange({ useCase: e.target.value })} placeholder="e.g. drafting client emails, workshop materials, social posts" disabled={disabled} className={inputCls} />
          <p className="text-2xs text-slate-400 dark:text-slate-500 mt-1">Helps tailor generated templates to your work.</p>
        </div>
        <div>
          <label className={labelCls}>Tone</label>
          <select value={value.tone} onChange={e => onChange({ tone: Number(e.target.value) as ToneLevel })} disabled={disabled} className={`${inputCls} appearance-none`}>
            {([1, 2, 3, 4, 5] as ToneLevel[]).map(t => <option key={t} value={t}>{TONE_LABELS[t]}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
