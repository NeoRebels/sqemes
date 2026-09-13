import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { IS_SELF_HOSTED } from '../lib/env';
import { useWorkspace, useUI } from '../store';
import { saveApiKey, deleteApiKey, getApiKeyStatus } from '../lib/api/apiKeys';
import { includedCredits } from '../lib/credits';
import { firstTextModelId } from '../lib/authoringAI';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import { ProviderIcon } from './ProviderIcon';
import WizardCreateStep, { type WizardAction } from './WizardCreateStep';
import Modal from './ui/Modal';
import ChromeWebStoreIcon from './icons/ChromeWebStoreIcon';
import SecretInput from './ui/SecretInput';
import {
  Key, Puzzle, Check, ExternalLink, Loader2, ArrowRight, ArrowLeft, Sparkles, ChevronDown, CheckCircle2, Circle, Wand2,
} from 'lucide-react';
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
 * SQEM-170 — starter-template creation is Cloud-only; self-host has no templates step.
 *
 * ⛔ SQEM-386 — ONE order everywhere: Templates → Extension → AI key → You're set. Self-host is the
 * same list without the first step, never a different list. Three UX tests (2026-09-08…11) and a
 * product manager's review said the same thing from different sides: the old path opened with
 * "paste an API key" — the one screen that explains nothing and frightens the audience this wizard
 * was rebuilt for — and ended in silence after the last click. Now it opens with the step every
 * tester called "magic" (templates generated for THEIR brand), the extension carries those templates
 * into ChatGPT/Claude (it needs no Sqemes key — it works in the person's own account), and the key
 * comes last as what brings AI INTO Sqemes Chat. Copy: *create your templates → use them in
 * ChatGPT, Claude & Co. with the extension → bring your AI into Sqemes Chat.*
 *
 * The final step is a ledger, not a call to action: what is done, what is not, where each thing
 * lives. The owner is reconsidering a "try it now" action (2026-09-12) and may run an in-app
 * onboarding after the wizard instead — so this step deliberately ends with "Done" and nothing else.
 */
type StepId = 'welcome' | 'templates' | 'extension' | 'provider' | 'done';

const STEPS: { id: StepId; label: string }[] = [
  // Round 2 (owner, 2026-09-12): a welcome screen first. The first cut squeezed the why into the
  // header and opened straight on the brand form — "thrown into cold water", and a crowded modal.
  { id: 'welcome', label: 'Welcome' },
  ...(IS_SELF_HOSTED ? [] : [{ id: 'templates' as const, label: 'Create playbooks' }]),
  { id: 'extension', label: 'Extension' },
  { id: 'provider', label: 'AI key' },
  { id: 'done', label: "You're set" },
];
/** The steps that ask for something — the progress bar and "Step n of m" count these only. */
const WORK_STEPS = STEPS.filter(s => s.id !== 'welcome' && s.id !== 'done');

const PRIMARY_BTN =
  'inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-200 dark:shadow-none';
const MUTED_BTN =
  'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors';

interface SetupWizardProps {
  /** Called when the wizard is dismissed or completed. `completed` distinguishes the two. */
  onClose: (completed: boolean) => void;
}

const SetupWizard = ({ onClose }: SetupWizardProps) => {
  const { workspace, updateWorkspace } = useWorkspace();
  const { showToast } = useUI();

  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [createAction, setCreateAction] = useState<WizardAction | null>(null);
  /** SQEM-386 — what the templates step actually created, for the ledger at the end. */
  const [createdCount, setCreatedCount] = useState(0);
  const current = STEPS[step].id;

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));
  const goTo = (id: StepId) => setStep(Math.max(0, STEPS.findIndex(s => s.id === id)));
  /** "Done" lands on Templates when something was created there — that is what the person wants to see. */
  const finish = () => {
    if (createdCount > 0) navigate('/playbooks');
    onClose(true);
  };
  /** A link in the ledger navigates by itself; the wizard only has to get out of the way. */
  const closeOnly = () => onClose(true);

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
  /**
   * SQEM-386 — the key step in three variants, because "optional" is only true in two of them.
   *  `credits`  — Cloud, metered plan: N credits a month, key optional. The SQEM-201 sentence, now
   *               the HEADLINE instead of a footnote under the provider grid — testers read the
   *               step as mandatory with the sentence on screen.
   *  `included` — Cloud, managed workspace (unmetered): AI works without a key. ⛔ SQEM-201 hid the
   *               whole notice here (`includedCredits` → 0 = "nothing true to say"), so the very
   *               workspace the UX testers sat on presented the key as a requirement it was not.
   *  `required` — self-host, or no funded model: the key IS what makes AI work here. Say so.
   */
  const keyMode: 'credits' | 'included' | 'required' =
    showCredits ? 'credits'
      : (!IS_SELF_HOSTED && !!workspace.fundedAvailable && workspace.isManaged) ? 'included'
      : 'required';

  // SQEM-203 — drives the single footer button's label and weight: "Next" once the step has actually
  // been done, an honest "Skip this step" while it hasn't. `templates` is not listed because the last
  // step's button comes from `createAction` instead.
  const extensionInstalled = useExtensionInstalled();
  const stepDone: Record<StepId, boolean> = {
    welcome: true,
    templates: createdCount > 0,
    provider: configured.size > 0,
    extension: extensionInstalled,
    done: true,
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
        {/* The why and the outcome live on the welcome screen (round 2) — the header stays a header. */}
        <div className="flex items-center gap-2 mt-4">
          {/* `i < step`: the welcome screen sits at index 0 and fills nothing. */}
          {WORK_STEPS.map((s, i) => (
            <div key={s.id} className={`h-1.5 rounded-full flex-1 transition-colors ${i < step ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 font-medium">
          {current === 'welcome' ? 'Welcome' : current === 'done' ? 'All done' : <>Step {step} of {WORK_STEPS.length} · {STEPS[step].label}</>}
        </p>
      </div>

      {/* Body */}
      <div className="px-6 py-6 md:px-8 min-h-[320px]">
        {/* ---- Welcome — the why and the outcome, before anything is asked (SQEM-386 round 2) ---- */}
        {current === 'welcome' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Welcome to Sqemes</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {IS_SELF_HOSTED
                    ? <>Two short steps, and your playbooks work inside ChatGPT, Claude &amp; Co. and in Sqemes Chat.</>
                    : <>Three short steps, and your first playbooks are ready — in Chat and inside ChatGPT, Claude &amp; Co.</>}
                </p>
              </div>
            </div>
            <ol className="space-y-3">
              {!IS_SELF_HOSTED && (
                <li className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0"><Wand2 className="w-4 h-4" /></div>
                  <div className="text-sm">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">Create your playbooks</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Your website is enough — AI drafts a starter set for your brand.</p>
                  </div>
                </li>
              )}
              <li className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0"><Puzzle className="w-4 h-4" /></div>
                <div className="text-sm">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Use them in ChatGPT, Claude &amp; Co.</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">The browser extension brings your playbooks into the AI you already use.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0"><Key className="w-4 h-4" /></div>
                <div className="text-sm">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Bring your AI into Sqemes Chat</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {IS_SELF_HOSTED ? <>Your own provider key powers Chat and generation here.</> : <>Included credits, or your own key — your choice.</>}
                  </p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* ---- Provider key ---- */}
        {current === 'provider' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
                <Key className="w-5 h-5" />
              </div>
              <div>
                {keyMode === 'required' ? (
                  <>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Add an AI provider key</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {IS_SELF_HOSTED
                        ? <>This instance runs on your own keys — one is needed for AI in Sqemes Chat and for generating playbooks. Bring your own key; Sqemes never charges for inference.</>
                        : <>Needed for AI in Sqemes Chat and for generating playbooks here. Bring your own key — Sqemes never charges for inference.</>}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Optional: add your own key</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Unlimited AI with your own ChatGPT, Claude, Gemini or Mistral account. You can also do this any time later in Settings → Integrations.</p>
                  </>
                )}
              </div>
            </div>

            {/* SQEM-386 — the reassurance comes FIRST. It used to sit under the provider grid, in
                small type, after a divider — and two testers read the step as mandatory anyway. */}
            {keyMode !== 'required' && (
              <div className="flex items-start gap-3 mb-5 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20">
                <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-800/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  {keyMode === 'credits' ? (
                    <>
                      {/* Deliberately "your workspace", not "your {plan} plan": the number is the
                          provisioned `credits_limit` when there is one, and that can differ from the
                          tier's advertised figure (a Team workspace on staging was metered at 2,000
                          against an advertised 25,000). Naming the plan would turn that mismatch into
                          a false promise to a paying customer; naming the workspace stays true either
                          way, and the plan card still carries the tier's own number. */}
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">You can start right away</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        Your workspace already includes {creditsIncluded.toLocaleString('en-US')} AI credits a month.{' '}
                        {hasByokText
                          ? <>Your own key is used first, so those credits stay untouched — and AI stays unlimited.</>
                          : <>Chat and your playbooks work without a key. Add one to make AI unlimited and leave the included credits untouched.</>}
                        {' '}<span className="text-slate-400 dark:text-slate-500">1 credit = 1,000 tokens.</span>
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">AI is included in your workspace</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        No key needed — Chat and your playbooks work right away. Add your own key only if you want a specific provider or model.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

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
              {/* SQEM-386 — show/hide: a tester pasted a key and could not check what he had pasted. */}
              <SecretInput
                value={keyValue}
                onChange={e => setKeyValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(); }}
                placeholder={configured.has(provider) ? '••••••••  (enter new key to replace)' : activeProvider.placeholder}
                className={`p-2.5 border rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-slate-900 dark:text-slate-100 ${configured.has(provider) && !keyValue ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700'}`}
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
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Use your playbooks inside ChatGPT, Claude &amp; Co.</h3>
                {/* The WHY, what is missing without it, and that it can wait — all three testers asked
                    "why do I need this?". Round 2 dropped the two 50/50 cards (a wall of logos left, a
                    lone Chrome mark right) for the store badge and two quiet lines. */}
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">The extension brings your playbooks into the AI you already use. Without it, playbooks work in Sqemes Chat only — and you can install it any time from Settings.</p>
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
              // Round 3 (owner): Google's official badge read as a picture, not a control — back to a
              // button. Round 4: the Chrome Web Store glyph (Simple Icons, CC0) leads it — the store is
              // what the button opens. ⚠️ Still no Chrome logo: Google's mark is not free to reuse.
              <div>
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none"
                >
                  <ChromeWebStoreIcon className="w-4 h-4" /> Install from Chrome Web Store <ExternalLink className="w-4 h-4" />
                </a>
                {/* Sets the expectation: a new tab opens, and this step notices when they return —
                    `useExtensionInstalled` pings again on focus (round 3). */}
                <p className="text-2xs text-slate-400 dark:text-slate-500 mt-2">
                  Opens the Chrome Web Store in a new tab. Come back here after installing — this step will notice.
                </p>
              </div>
            )}

            <div className="mt-5 space-y-1.5 text-2xs text-slate-500 dark:text-slate-400">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-semibold uppercase tracking-wider text-slate-400">Works with</span>
                {EXTENSION_LLMS.map(llm => (
                  <span key={llm.label} className="inline-flex items-center gap-1">
                    <ProviderIcon provider={llm.provider} className="w-3.5 h-3.5" /> {llm.label}
                  </span>
                ))}
              </p>
              <p>
                <span className="font-semibold uppercase tracking-wider text-slate-400">In</span> Chrome, Edge, Brave, Arc, Opera, Vivaldi
              </p>
            </div>
          </div>
        )}

        {/* ---- Create templates (Cloud only, first) ---- */}
        {current === 'templates' && (
          <WizardCreateStep
            onComplete={count => { setCreatedCount(count); next(); }}
            onConnectKey={() => goTo('provider')}
            onActionChange={setCreateAction}
          />
        )}

        {/* ---- You're set — a ledger, not a call to action (SQEM-386) ---- */}
        {current === 'done' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">You&apos;re set</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Here is where your workspace stands. Everything below can be changed later.</p>
              </div>
            </div>
            <ul className="space-y-3">
              {/* Templates */}
              <li className="flex items-start gap-3">
                {createdCount > 0
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Playbooks</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {createdCount > 0
                      ? <>{createdCount} playbook{createdCount === 1 ? '' : 's'} created — find them under <Link to="/playbooks" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Playbooks</Link>.</>
                      : <>No playbooks yet. Your library fills from the <Link to="/playbooks/new" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">editor</Link>, a <Link to="/playbooks" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">.sqemes import</Link>, or the <Link to="/library" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Marketplace</Link>.</>}
                    {/* Round 2 (owner): promote the wizards where the person is — the ledger. */}
                    {!IS_SELF_HOSTED && <> Need another one? The <Link to="/playbooks" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Playbook Wizard</Link> writes it from a sentence.</>}
                  </p>
                </div>
              </li>
              {/* Extension */}
              <li className="flex items-start gap-3">
                {extensionInstalled
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Browser extension</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {extensionInstalled
                      ? <>Installed — your playbooks are available inside ChatGPT, Claude &amp; Co.</>
                      : <>Not yet — install it any time from the <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Chrome Web Store</a>.</>}
                  </p>
                </div>
              </li>
              {/* AI key */}
              <li className="flex items-start gap-3">
                {configured.size > 0 || keyMode !== 'required'
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">AI in Sqemes Chat</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {configured.size > 0
                      ? <>Your own key is set — AI in Sqemes Chat is unlimited.</>
                      : keyMode === 'credits'
                        ? <>AI credits are included. Add your own key any time in <Link to="/settings" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Settings → Integrations</Link>.</>
                        : keyMode === 'included'
                          ? <>AI is included in your workspace — nothing to do.</>
                          : <>Not yet — a provider key is needed for AI in Sqemes Chat. Add it in <Link to="/settings" onClick={closeOnly} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">Settings → Integrations</Link>.</>}
                  </p>
                </div>
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 md:px-8 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
        {current === 'done' ? (
          <span />
        ) : step > 0 ? (
          <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        ) : (
          // SQEM-386 — this closes the WHOLE wizard, and the old label ("I'll do this later") did not
          // say so next to a step-level "Skip". A tester feared losing the step for good. The way back
          // is named: the dashboard banner reopens it.
          <button onClick={() => onClose(false)} className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            Later — reopen from the dashboard
          </button>
        )}

        {/* SQEM-203 — exactly one button on the right.
            It used to be two, and they called the same function: `<button onClick={next}>Skip</button>`
            next to `<button onClick={next}>Next</button>`. Identical behaviour, two labels, two
            weights — a choice that was not one, with the visually dominant option silently skipping
            the step. Now the single button says what it will actually do, and carries primary weight
            only when the step has been completed. */}
        <div className="flex items-center gap-2">
          {current === 'templates' ? (
            // The templates step is the one place two buttons are honest: generating and moving on
            // are genuinely different acts. The audit's complaint was never "two buttons" — it was two
            // buttons calling the same function. So "Skip for now" goes to the NEXT step (SQEM-386;
            // it used to close the wizard, which on the last step was the same thing).
            <>
              {createAction && (
                <button onClick={next} className={MUTED_BTN}>Skip for now</button>
              )}
              {createAction ? (
                (!createAction.disabled || createAction.loading) && (
                  <button onClick={createAction.onClick} disabled={createAction.loading} className={PRIMARY_BTN}>
                    {createAction.loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {createAction.label}
                  </button>
                )
              ) : (
                <button onClick={next} className={MUTED_BTN}>Skip for now <ArrowRight className="w-4 h-4" /></button>
              )}
            </>
          ) : current === 'welcome' ? (
            <button onClick={next} className={PRIMARY_BTN}>Let&apos;s go <ArrowRight className="w-4 h-4" /></button>
          ) : current === 'done' ? (
            <button onClick={finish} className={PRIMARY_BTN}>Done</button>
          ) : (
            <button onClick={next} className={stepDone[current] ? PRIMARY_BTN : MUTED_BTN}>
              {stepDone[current] ? 'Next' : 'Skip for now'} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SetupWizard;
