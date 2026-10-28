import { useState } from 'react';
import { useWorkspace, useUI } from '../store';
import { authoringModelId, hasAuthoringAlternatives } from '../lib/authoringAI';
import { analyzeWebsite } from '../lib/wizardGeneration';
import type { BrandProfile } from '../types';
import { Loader2, Globe, AlertCircle } from 'lucide-react';
import { describeAIError } from '../lib/aiErrors';
import { Input } from './ui/Input';
import { m } from '../lib/i18n';

// SQEM-106 — shared brand form used by both onboarding (WizardCreateStep) and
// Settings → Brand. Owns the "Analyze your website" prefill + the brand fields.
// Controlled via `value`/`onChange`; analyze reads the workspace AI config itself.
// SQEM-395 — three fields and the website. "Tone of your playbooks" (a 1–5 select nobody chose
// consciously — the website analysis guessed it, the default was 3) and "What do you want to use AI
// for?" (which the Playbook Wizard asks per playbook anyway) are gone, here and in Settings → Brand.
export interface BrandFormValue {
  brandName: string;
  whatItDoes: string;
  audience: string;
  website: string;
}

export const EMPTY_BRAND_FORM: BrandFormValue = {
  brandName: '', whatItDoes: '', audience: '', website: '',
};

export function brandFormFromProfile(p?: BrandProfile): BrandFormValue {
  return {
    brandName: p?.brandName ?? '',
    whatItDoes: p?.whatItDoes ?? '',
    audience: p?.audience ?? '',
    website: p?.website ?? '',
  };
}

// SQEM-554 (d1) — on tokens; the same form sits in the setup wizard. SQEM-602 — its fields are ui/Input now.
const labelCls = 'block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-1.5';

export function BrandProfileForm({
  value,
  onChange,
  disabled = false,
  collapsible = false,
}: {
  value: BrandFormValue;
  onChange: (patch: Partial<BrandFormValue>) => void;
  disabled?: boolean;
  /**
   * SQEM-386 (rounds 2–3) — in the setup wizard the form is ONE view at a time: the website field
   * (with Analyze) OR the three manual fields, with a link each way. A successful analysis switches to
   * the fields so what was filled in is visible. Round 2 had the fields fold out UNDER the website
   * field; the owner wanted the two to replace each other, with a way back. Settings → Brand keeps
   * the full form: there the person came to edit exactly those fields.
   */
  collapsible?: boolean;
}) {
  const { workspace } = useWorkspace();
  const { showToast } = useUI();
  const modelId = authoringModelId(workspace);
  const canUseAI = !!modelId || !!workspace.fundedAvailable;
  const [analyzing, setAnalyzing] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [view, setView] = useState<'website' | 'manual'>('website');

  const handleAnalyze = async () => {
    if (!canUseAI || !value.website.trim()) return;
    // SQEM-203 — add the scheme instead of complaining about it. The field is `type="url"`, but the
    // button submits no form, so native validation never runs: we used to send "example.com" to the
    // server purely to be told no. Writing the normalised value back also shows what was actually
    // requested.
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.website.trim())
      ? value.website.trim()
      : `https://${value.website.trim()}`;
    if (url !== value.website) onChange({ website: url });
    setWebsiteError(null);
    setAnalyzing(true);
    try {
      const fields = await analyzeWebsite(url, { workspaceId: workspace.id, modelId });
      const patch: Partial<BrandFormValue> = {};
      if (fields.brandName) patch.brandName = fields.brandName;
      if (fields.whatItDoes) patch.whatItDoes = fields.whatItDoes;
      if (fields.audience) patch.audience = fields.audience;
      onChange(patch);
      setView('manual');
      showToast(m.bp_filled(), 'success');
    } catch (err: any) {
      // SQEM-203 — this belongs at the field, not in a toast 1200px away in the opposite corner
      // that disappears after a few seconds. It stays until the input changes.
      setWebsiteError(describeAIError(err, m.bp_read_failed(), { alternativesAvailable: hasAuthoringAlternatives(workspace) }));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div>
      {/* Website URL — analyzes the homepage and fills the form */}
      {(!collapsible || view === 'website') && (
      <div className="mb-4">
        <label htmlFor="brand-profile-form-website" className={labelCls}>
          {m.bp_analyze_label()} <span className="normal-case font-normal text-ink-subtle">{m.bp_analyze_optional()}</span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input id="brand-profile-form-website"
            type="url"
            value={value.website}
            onChange={e => { onChange({ website: e.target.value }); setWebsiteError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
            placeholder="https://yourbrand.com"
            disabled={disabled}
            aria-invalid={!!websiteError}
            aria-describedby={websiteError ? 'website-error' : undefined}
            className="flex-1"
            tone={websiteError ? 'error' : 'default'}
          />
          <button
            onClick={handleAnalyze}
            disabled={disabled || !canUseAI || !value.website.trim() || analyzing}
            className="shrink-0 px-4 py-3 bg-ink-strong hover:opacity-90 text-surface-raised rounded-control text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> {m.bp_analyzing()}</> : <><Globe className="w-4 h-4" /> {m.bp_analyze()}</>}
          </button>
        </div>
        {websiteError && (
          <p id="website-error" role="alert" className="flex items-start gap-1.5 text-xs text-danger mt-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {websiteError}
          </p>
        )}
        {!canUseAI && !websiteError && (
          <p className="text-2xs text-ink-subtle mt-1">{m.bp_needs_ai()}</p>
        )}
      </div>
      )}

      {collapsible ? (
        view === 'website' ? (
          <button
            type="button"
            onClick={() => setView('manual')}
            className="text-xs font-semibold text-accent hover:underline mb-4"
          >
            {m.bp_manual()}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setView('website')}
            className="text-xs font-semibold text-accent hover:underline mb-4"
          >
            {m.bp_back_to_site()}
          </button>
        )
      ) : (
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-line-strong" />
          <span className="text-2xs font-semibold text-ink-subtle uppercase tracking-wider">{m.bp_or_manual()}</span>
          <div className="flex-1 h-px bg-line-strong" />
        </div>
      )}

      {(!collapsible || view === 'manual') && (
      <div className="space-y-3">
        <div>
          <label htmlFor="brand-profile-form-brand-name" className={labelCls}>{m.bp_name()}</label>
          <Input id="brand-profile-form-brand-name" value={value.brandName} onChange={e => onChange({ brandName: e.target.value })} placeholder={m.bp_name_placeholder()} disabled={disabled} />
        </div>
        <div>
          <label htmlFor="brand-profile-form-what-does-your-brand-do" className={labelCls}>{m.bp_what()}</label>
          <Input id="brand-profile-form-what-does-your-brand-do" value={value.whatItDoes} onChange={e => onChange({ whatItDoes: e.target.value })} placeholder={m.bp_what_placeholder()} disabled={disabled} />
        </div>
        <div>
          <label htmlFor="brand-profile-form-who-is-your-audience" className={labelCls}>{m.bp_audience()}</label>
          <Input id="brand-profile-form-who-is-your-audience" value={value.audience} onChange={e => onChange({ audience: e.target.value })} placeholder={m.bp_audience_placeholder()} disabled={disabled} />
        </div>
      </div>
      )}
    </div>
  );
}
