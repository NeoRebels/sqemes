import { useState } from 'react';
import { IS_SELF_HOSTED } from '../lib/env';
import { useWorkspace, useUI } from '../store';
import { saveApiKey, deleteApiKey, getApiKeyStatus } from '../lib/api/apiKeys';
import { includedCredits } from '../lib/credits';
import { firstTextModelId } from '../lib/authoringAI';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import { ProviderIcon } from './ProviderIcon';
import WizardCreateStep, { type WizardAction } from './WizardCreateStep';
import Modal from './ui/Modal';
import {
  Key, Puzzle, Check, ExternalLink, Loader2, ArrowRight, ArrowLeft, Sparkles, ChevronDown,
} from 'lucide-react';
import chromeSrc from '../assets/browsers/chrome.svg';
import { CHROME_STORE_URL } from '../lib/links';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', placeholder: 'AIza...', link: 'https://aistudio.google.com/app/apikey' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...', link: 'https://platform.openai.com/settings/organization/api-keys' },
  { id: 'claude', name: 'Anthropic Claude', placeholder: 'sk-ant-...', link: 'https://console.anthropic.com/settings/keys' },
  { id: 'grok', name: 'xAI Grok', placeholder: 'xai-...', link: 'https://console.x.ai/' },
  { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...', link: 'https://platform.deepseek.com/api_keys' },
  { id: 'mistral', name: 'Mistral AI', placeholder: 'os-...', link: 'https://console.mistral.ai/api-keys/' },
];

// LLM surfaces the extension injects into (VISION.md)
const EXTENSION_LLMS = [
  { label: 'ChatGPT', provider: 'openai' },
  { label: 'Claude', provider: 'claude' },
  { label: 'Gemini', provider: 'gemini' },
  { label: 'Grok', provider: 'grok' },
  { label: 'DeepSeek', provider: 'deepseek' },
  { label: 'Perplexity', provider: 'perplexity' },
];

/**
 * SQEM-201 — the mandatory path is three steps, and the one that shows what the product does
 * comes last of the three rather than fifth of five.
 *
 * Dropped from the path (both remain reachable, better placed):
 *   MCP             — an unexpanded acronym, a raw endpoint URL and a JSON block as the *second*
 *                     screen after signup. The dashboard already lists it under "Connections",
 *                     optional and named; Settings → API & MCP has the full version.
 *   Template access — asked in a workspace that has exactly one member, with the correct default
 *                     already selected. Lives in Settings → General, and in the editor per template.
 *
 * Steps are keyed by **id, not index**. The old code guarded each block with `step === N`, so the
 * self-host variant (a shorter array) and the Cloud variant silently disagreed about which number
 * meant which screen — the exact trap this ticket was warned about. Adding or removing a step now
 * cannot desynchronise the two.
 *
 * SQEM-170 — starter-template creation is Cloud-only; self-host ends after Extension.
 */
type StepId = 'provider' | 'extension' | 'templates';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'provider', label: 'Provider key' },
  { id: 'extension', label: 'Extension' },
  ...(IS_SELF_HOSTED ? [] : [{ id: 'templates' as const, label: 'Create templates' }]),
];

const PRIMARY_BTN =
  'inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-200 dark:shadow-none';
const MUTED_BTN =
  'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors';

interface SetupWizardProps {
  /** Called when the wizard is dismissed or completed. `completed` distinguishes the two. */
  onClose: (completed: boolean) => void;
}

const IconTile = ({ children }: { children: React.ReactNode }) => (
  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 dark:border-slate-600 flex items-center justify-center shrink-0">
    {children}
  </div>
);

const SetupWizard = ({ onClose }: SetupWizardProps) => {
  const { workspace, updateWorkspace } = useWorkspace();
  const { showToast } = useUI();

  const [step, setStep] = useState(0);
  const [createAction, setCreateAction] = useState<WizardAction | null>(null);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step].id;

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  // --- API key state ---
  const initialConfigured = new Set(
    Object.entries(workspace.apiKeys || {}).filter(([, v]) => !!v).map(([k]) => k),
  );
  const [configured, setConfigured] = useState<Set<string>>(initialConfigured);
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [providerOpen, setProviderOpen] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const activeProvider = PROVIDERS.find(p => p.id === provider) ?? PROVIDERS[0];

  /**
   * SQEM-201 — what the plan already covers, said at the step that asks for a key.
   *
   * The step reads as a requirement ("Add an AI provider key") when it is in fact optional on
   * Cloud: every paid tier ships a monthly funded allowance, so Chat and the generation in step 3
   * work before any key exists. Someone who does not have a provider account — the audience this
   * onboarding was rebuilt for — otherwise has no way to tell that skipping is safe.
   *
   * Hidden when there is nothing true to say: self-host has no plans, `fundedAvailable` false means
   * no funded model is configured, and managed workspaces are not metered (`includedCredits` → 0).
   */
  const creditsIncluded = includedCredits(workspace);
  const hasByokText = firstTextModelId(workspace.apiKeys) !== null;
  const showCredits = !IS_SELF_HOSTED && !!workspace.fundedAvailable && creditsIncluded > 0;

  // SQEM-203 — drives the single footer button's label and weight: "Next" once the step has actually
  // been done, an honest "Skip this step" while it hasn't. `templates` is not listed because the last
  // step's button comes from `createAction` instead.
  const extensionInstalled = useExtensionInstalled();
  const stepDone: Record<StepId, boolean> = {
    provider: configured.size > 0,
    extension: extensionInstalled,
    templates: false,
  };

  const handleSaveKey = async () => {
    const trimmed = keyValue.trim();
    if (!trimmed) return;
    setSavingKey(true);
    try {
      await saveApiKey(workspace.id, provider, trimmed);
      setConfigured(prev => new Set(prev).add(provider));
      // Sync the store so the Create-templates step's generation gate sees the new key.
      updateWorkspace({ apiKeys: { ...workspace.apiKeys, [provider]: '••••••••' } });
      setKeyValue('');
      showToast(`${activeProvider.name} key saved`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save key', 'error');
    } finally {
      setSavingKey(false);
    }
  };

  /**
   * SQEM-203 — a key pasted into the wrong provider could not be taken back: the step only ever
   * added. Same call and same refresh as Settings → Integrations (`handleRemoveKey` there), so the
   * two places cannot drift apart.
   *
   * `configured` is rebuilt from the server's answer rather than by deleting one entry locally —
   * the response is the truth about what is stored, and it also keeps `stepDone.provider` honest:
   * remove the last key and the footer button goes back to "Skip this step" on its own.
   */
  const handleRemoveKey = async () => {
    setRemovingKey(true);
    try {
      await deleteApiKey(workspace.id, provider);
      const { keys: status, fundedAvailable } = await getApiKeyStatus(workspace.id);
      const remaining: Record<string, string> = {};
      for (const [p, isConfigured] of Object.entries(status)) {
        if (isConfigured) remaining[p] = '••••••••';
      }
      updateWorkspace({ apiKeys: remaining, fundedAvailable });
      setConfigured(new Set(Object.keys(remaining)));
      setConfirmRemove(false);
      showToast(`${activeProvider.name} key removed`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove key', 'error');
    } finally {
      setRemovingKey(false);
    }
  };

  return (
    <Modal open onClose={() => onClose(false)} size="xl" overlayOpacity="high" className="p-0 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 md:px-8 md:py-6 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-500 mb-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Getting started
        </div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">Set up your workspace</h2>
        <div className="flex items-center gap-2 mt-4">
          {STEPS.map((s, i) => (
            <div key={s.id} className={`h-1.5 rounded-full flex-1 transition-colors ${i <= step ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 font-medium">Step {step + 1} of {STEPS.length} · {STEPS[step].label}</p>
      </div>

      {/* Body */}
      <div className="px-6 py-6 md:px-8 min-h-[320px]">
        {/* ---- Provider key ---- */}
        {current === 'provider' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Add an AI provider key</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Powers in-app Chat and AI generation. Bring your own key — Sqemes never charges for inference.</p>
              </div>
            </div>

            {/* One row: provider dropdown (with icons) + input + save */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative sm:w-52 shrink-0" onKeyDown={e => { if (e.key === 'Escape') setProviderOpen(false); }}>
                <button
                  type="button"
                  onClick={() => setProviderOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={providerOpen}
                  className="w-full flex items-center gap-2 p-2.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                >
                  <ProviderIcon provider={provider} className="w-5 h-5 shrink-0" />
                  <span className="flex-1 text-left text-slate-900 dark:text-slate-100 truncate">{activeProvider.name}</span>
                  {configured.has(provider) && !keyValue && (
                    <span className="text-2xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-md font-bold shrink-0">Configured</span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${providerOpen ? 'rotate-180' : ''}`} />
                </button>
                {providerOpen && (
                  <>
                    <button type="button" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setProviderOpen(false)} aria-hidden />
                    <div role="listbox" aria-label="AI provider" className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl overflow-hidden py-1">
                      {PROVIDERS.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          role="option"
                          aria-selected={p.id === provider}
                          onClick={() => { setProvider(p.id); setProviderOpen(false); setConfirmRemove(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${p.id === provider ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
                        >
                          <ProviderIcon provider={p.id} className="w-5 h-5 shrink-0" />
                          <span className="flex-1 text-left text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                          {configured.has(p.id) && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <input
                type="password"
                value={keyValue}
                onChange={e => setKeyValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(); }}
                placeholder={configured.has(provider) ? '••••••••  (enter new key to replace)' : activeProvider.placeholder}
                className={`flex-1 p-2.5 border rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-slate-900 dark:text-slate-100 ${configured.has(provider) && !keyValue ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700'}`}
              />
              <button
                onClick={handleSaveKey}
                disabled={!keyValue.trim() || savingKey}
                className="shrink-0 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mt-2.5 flex-wrap">
              <a href={activeProvider.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline group/link">
                Get a {activeProvider.name} key <ExternalLink className="w-3 h-3 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
              </a>

              {/* SQEM-203 — the way back out. Confirmed inline rather than in a second Modal: the
                  wizard is already one, and stacking two dialogs on a first-run screen reads as an
                  error. Hidden while a replacement key is being typed — saving already replaces. */}
              {configured.has(provider) && !keyValue && (
                confirmRemove ? (
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Remove the saved {activeProvider.name} key?</span>
                    <button
                      type="button"
                      onClick={handleRemoveKey}
                      disabled={removingKey}
                      className="font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      {removingKey ? 'Removing…' : 'Remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="text-xs font-bold text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                  >
                    Remove key
                  </button>
                )
              )}
            </div>

            {/* SQEM-201 — the plan's own allowance, so "skip" is visibly a real option. */}
            {showCredits && (
              <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    {/* Deliberately "your workspace", not "your {plan} plan": the number is the
                        provisioned `credits_limit` when there is one, and that can differ from the
                        tier's advertised figure (a Team workspace on staging was metered at 2,000
                        against an advertised 25,000). Naming the plan would turn that mismatch into
                        a false promise to a paying customer; naming the workspace stays true either
                        way, and the plan card still carries the tier's own number. */}
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Your workspace already includes {creditsIncluded.toLocaleString('en-US')} AI credits a month
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {hasByokText
                        ? <>Your own key is used first, so those credits stay untouched — and AI stays unlimited.</>
                        : <>Chat and the templates in step 3 work right away, without a key. Add one to make AI unlimited and leave the included credits untouched.</>}
                      {' '}<span className="text-slate-400 dark:text-slate-500">1 credit = 1,000 tokens.</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- Extension ---- */}
        {current === 'extension' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
                <Puzzle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Install the browser extension</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pull any template into the AI you&apos;re already using — pick a template, fill in the variables, and it&apos;s inserted straight into the chat box. No copy-paste.</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-5">
              {/* Works with */}
              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-2xl p-4">
                <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-3">Works with</p>
                <div className="grid grid-cols-3 gap-3">
                  {EXTENSION_LLMS.map(llm => (
                    <div key={llm.label} className="flex flex-col items-center gap-1.5">
                      <IconTile><ProviderIcon provider={llm.provider} className="w-5 h-5" /></IconTile>
                      <span className="text-2xs font-semibold text-slate-600 dark:text-slate-300 text-center">{llm.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Works on — SQEM-207 (P-01/P-02).
                  "Works on Chromium browsers" used a word the audience does not have: for them
                  Chromium is not a thing, Chrome is. And Chrome was the *only* icon that did not
                  look like itself — the set is monochrome Simple Icons glyphs, which is right for
                  Brave, Opera and Vivaldi (their real marks are single-colour) and wrong for the one
                  browser this actually ships to. Chrome now leads with its own colours; the rest sit
                  behind a line of text instead of competing with it. */}
              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-2xl p-4">
                <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-3">Works in</p>
                <div className="flex items-center gap-2.5">
                  <IconTile><img src={chromeSrc} className="w-5 h-5" alt="" /></IconTile>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-tight">Chrome</p>
                    <p className="text-2xs text-slate-500 dark:text-slate-400 leading-tight">
                      …and Edge, Brave, Arc, Opera, Vivaldi
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* SQEM-207 (P-03) — installation used to end in silence: the button opened a new tab
                and nothing here ever changed. `useExtensionInstalled` has existed since SQEM-079 and
                the sidebar already used it; the step that asks for the install did not. */}
            {extensionInstalled ? (
              <p className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm font-bold">
                <Check className="w-4 h-4" /> Extension installed — you&apos;re set
              </p>
            ) : (
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all"
              >
                Install from Chrome Web Store <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}

        {/* ---- Create templates (Cloud only) ---- */}
        {current === 'templates' && <WizardCreateStep onComplete={() => onClose(true)} onConnectKey={() => setStep(0)} onActionChange={setCreateAction} />}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 md:px-8 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        ) : (
          <button onClick={() => onClose(false)} className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            I&apos;ll do this later
          </button>
        )}

        {/* SQEM-203 — exactly one button on the right.
            It used to be two, and they called the same function: `<button onClick={next}>Skip</button>`
            next to `<button onClick={next}>Next</button>`. Identical behaviour, two labels, two
            weights — a choice that was not one, with the visually dominant option silently skipping
            the step. Now the single button says what it will actually do, and carries primary weight
            only when the step has been completed. */}
        <div className="flex items-center gap-2">
          {isLast ? (
            // The last step is the one place two buttons are honest: generating and leaving are
            // genuinely different acts. The audit's complaint was never "two buttons" — it was two
            // buttons calling the same function. So the exit stays visible next to the action;
            // collapsing it away left anyone who filled the form and changed their mind with no
            // way out but the Escape key, which this product's audience will not go looking for.
            <>
              {createAction && (
                <button onClick={() => onClose(true)} className={MUTED_BTN}>Skip for now</button>
              )}
              {createAction ? (
                (!createAction.disabled || createAction.loading) && (
                  <button onClick={createAction.onClick} disabled={createAction.loading} className={PRIMARY_BTN}>
                    {createAction.loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {createAction.label}
                  </button>
                )
              ) : (
                // Self-host: this step has no create action at all (SQEM-170).
                <button onClick={() => onClose(true)} className={PRIMARY_BTN}>Done</button>
              )}
            </>
          ) : (
            <button onClick={next} className={stepDone[current] ? PRIMARY_BTN : MUTED_BTN}>
              {stepDone[current] ? 'Next' : 'Skip this step'} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SetupWizard;
