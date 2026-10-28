import React, { useState, useMemo, useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { IS_SELF_HOSTED, functionsUrl } from '../lib/env';
import { copyToClipboard } from '../lib/clipboard';
import { useWorkspace, useUI } from '../store';
import { saveApiKey, deleteApiKey, getApiKeyStatus, hasUsedMcpConnection } from '../lib/api/apiKeys';
import { includedCredits } from '../lib/credits';
import { firstTextModelId } from '../lib/authoringAI';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import { ProviderIcon } from './ProviderIcon';
import WizardCreateStep, { type WizardAction } from './WizardCreateStep';
import Modal from './ui/Modal';
import ChromeWebStoreIcon from './icons/ChromeWebStoreIcon';
import McpIcon from './McpIcon';
import SecretInput from './ui/SecretInput';
import McpClientGuide from './McpClientGuide';
import {
  Key, Puzzle, Check, Copy, ExternalLink, Loader2, ArrowRight, ArrowLeft, Sparkles, ChevronDown, CheckCircle2, Circle, Wand2, Chromium, MessageSquare,
} from 'lucide-react';
import { CHROME_STORE_URL } from '../lib/links';
import { m, getLocale } from '../lib/i18n';

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
 *                     already selected. Lives in Settings → Security (General until SQEM-480), and in the editor per template.
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
type StepId = 'welcome' | 'templates' | 'channels' | 'extension' | 'mcp' | 'provider' | 'done';

/**
 * SQEM-414 — where the person wants to use their playbooks. A UX tester (2026-09-15) worked in the
 * ChatGPT DESKTOP app and was shown a browser-extension step he could not use; he said plainly that
 * not everyone knows whether they are in a browser or in an app. So the wizard asks instead of
 * assuming, and only the matching setup steps follow.
 */
type Channel = 'browser' | 'chat' | 'mcp';

/**
 * SQEM-421 — the three cards say what sqemes.com says, word for word, with the website's own icons
 * (lucide `chromium` and `message-square`; the MCP mark in `McpIcon` is the same single Simple-Icons
 * path the site serves). ⚠️ Someone arriving here has just read those sentences on the website — the
 * wizard repeating them differently is the moment a product starts to feel like two products. The
 * third card also finally names **MCP**, which the earlier wording never did.
 */
// SQEM-610 — messages, called at render. `name` is what the closing banner lists ("They work in …");
// it used to be the title with "In " stripped off, which only works in English.
const CHANNELS: { id: Channel; title: () => string; text: () => string; name: () => string; icon: ReactNode }[] = [
  {
    id: 'browser',
    title: m.sw_ch_browser,
    text: m.sw_ch_browser_text,
    name: m.sw_ch_browser_name,
    icon: <Chromium className="w-4 h-4" />,
  },
  {
    id: 'chat',
    title: m.sw_ch_chat,
    text: m.sw_ch_chat_text,
    name: m.sw_ch_chat_name,
    icon: <MessageSquare className="w-4 h-4" />,
  },
  {
    id: 'mcp',
    title: m.sw_ch_mcp,
    text: m.sw_ch_mcp_text,
    name: m.sw_ch_mcp_name,
    icon: <McpIcon className="w-4 h-4" />,
  },
];

/**
 * SQEM-418 — the key step follows the same rule as the other setup steps: it exists when it has
 * something to do. ⚠️ It is NOT a Chat-only step, which is why it is not gated on the channel alone:
 * the same key generates the starter playbooks, drafts in the Playbook Wizard, adapts a marketplace
 * listing and enhances a prompt. Where AI already works without one (Cloud credits, a managed
 * workspace) and Chat was not chosen, the step is a question with no occasion — Settings →
 * Integrations is where a key belongs then. Where nothing AI-powered works without it
 * (`keyMode === 'required'`: self-host, or no funded model) the step stays in every case, or that
 * instance would finish onboarding with no place to put a key at all.
 */
const STEPS_FOR = (channels: Channel[], keyRequired: boolean): { id: StepId; label: string }[] => [
  // Round 2 (owner, 2026-09-12): a welcome screen first. The first cut squeezed the why into the
  // header and opened straight on the brand form — "thrown into cold water", and a crowded modal.
  { id: 'welcome', label: m.sw_step_welcome() },
  ...(IS_SELF_HOSTED ? [] : [{ id: 'templates' as const, label: m.sw_step_templates() }]),
  { id: 'channels', label: m.sw_step_channels() },
  ...(channels.includes('browser') ? [{ id: 'extension' as const, label: m.sw_step_extension() }] : []),
  // SQEM-424 — the owner's labels. ⚠️ "MCP" is the acronym SQEM-201 removed from onboarding; it is
  // back HERE only, as a four-character progress chip, while the step's own heading still names the
  // tools ("In Claude Code, Cursor and Codex"). That is the line: chip may abbreviate, heading may not.
  ...(channels.includes('mcp') ? [{ id: 'mcp' as const, label: 'MCP' }] : []),
  // SQEM-424 — the same words as the Overview's link to this step (ov_provider_keys).
  ...(channels.includes('chat') || keyRequired ? [{ id: 'provider' as const, label: m.ov_provider_keys() }] : []),
  { id: 'done', label: m.sw_step_done() },
];

const PRIMARY_BTN =
  'inline-flex items-center gap-2 px-5 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg';
const MUTED_BTN =
  'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ink-muted hover:text-ink-strong transition-colors';

interface SetupWizardProps {
  /** Called when the wizard is dismissed or completed. `completed` distinguishes the two. */
  onClose: (completed: boolean) => void;
}

const SetupWizard = ({ onClose }: SetupWizardProps) => {
  const { workspace, updateWorkspace } = useWorkspace();
  const { showToast } = useUI();

  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  /**
   * SQEM-414 — the chosen channels decide which steps exist. ⚠️ Steps are only ever ADDED behind the
   * channels step, never before it, so the current index keeps pointing at the same step while the
   * person is still choosing.
   */
  const [channels, setChannels] = useState<Channel[]>([]);
  const [mcpCopied, setMcpCopied] = useState(false);
  /**
   * SQEM-425 — whether a desktop app or editor has actually spoken to this workspace. Asked once, and
   * only when it can matter: the MCP channel was chosen and the person reached the closing screen.
   * ⚠️ Expect `false` on a first run — nobody has opened Claude Desktop while still clicking through
   * the wizard. That is the point: the row states what is known, and turns green for whoever reopens
   * the wizard later. There is no live signal for MCP the way there is for the extension's ping.
   */
  const [mcpConnected, setMcpConnected] = useState(false);
  /** Same URL the Settings card shows — one source for the endpoint a person copies. */
  const MCP_URL = functionsUrl('mcp-server');
  const creditsIncluded = includedCredits(workspace);
  const hasByokText = firstTextModelId(workspace.apiKeys, workspace.openrouterModels) !== null;
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

  const STEPS = useMemo(() => STEPS_FOR(channels, keyMode === 'required'), [channels, keyMode]);
  /**
   * SQEM-417 — the closing banner names the channels in the person's own words. Derived from
   * `CHANNELS`, so a channel added there is named here without a second list to keep in sync.
   */
  const channelSummary = useMemo(() => {
    const names = CHANNELS.filter(c => channels.includes(c.id)).map(c => c.name());
    if (names.length === 0) return '';
    // SQEM-610 — "a, b and c" in the app language.
    return new Intl.ListFormat(getLocale(), { style: 'long', type: 'conjunction' }).format(names);
  }, [channels]);
  /** The steps that ask for something — the progress bar and "Step n of m" count these only. */
  const WORK_STEPS = useMemo(() => STEPS.filter(s => s.id !== 'welcome' && s.id !== 'done'), [STEPS]);
  const [createAction, setCreateAction] = useState<WizardAction | null>(null);
  /**
   * SQEM-413 — a step can claim the footer's Back button. The templates step does while its review is
   * open: Back then returns to the brand form instead of leaving the step, which is what the removed
   * "← Edit brand" link used to do under a name a tester read as "edit colours".
   */
  const [stepBack, setStepBack] = useState<(() => void) | null>(null);
  /** SQEM-386 — what the templates step actually created, for the ledger at the end. */
  const [createdCount, setCreatedCount] = useState(0);
  const current = STEPS[step].id;

  // SQEM-425 — asked once, on the screen that reports it. `cancelled` guards the close: the wizard can
  // be dismissed while the query is in flight, and a setState afterwards would land on a dead component.
  useEffect(() => {
    if (current !== 'done' || !channels.includes('mcp') || !workspace.id) return;
    let cancelled = false;
    hasUsedMcpConnection(workspace.id).then(used => { if (!cancelled) setMcpConnected(used); });
    return () => { cancelled = true; };
  }, [current, channels, workspace.id]);

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => {
    if (stepBack) { stepBack(); return; }
    setStep(s => Math.max(s - 1, 0));
  };
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

  // SQEM-203 — drives the single footer button's label and weight: "Next" once the step has actually
  // been done, an honest "Skip this step" while it hasn't. `templates` is not listed because the last
  // step's button comes from `createAction` instead.
  const extensionInstalled = useExtensionInstalled();
  const stepDone: Record<StepId, boolean> = {
    welcome: true,
    templates: createdCount > 0,
    // SQEM-414 — the channel step is done once something is picked; the MCP step asks for nothing
    // that this wizard can verify (the connecting happens in the other tool), so it never nags.
    channels: channels.length > 0,
    provider: configured.size > 0,
    extension: extensionInstalled,
    mcp: true,
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
      showToast(m.sw_key_saved({ provider: activeProvider.name }), 'success');
    } catch (err: any) {
      showToast(err.message || m.sw_key_save_failed(), 'error');
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
      const { keys: status, fundedAvailable, webSearchHosted } = await getApiKeyStatus(workspace.id);
      const remaining: Record<string, string> = {};
      for (const [p, isConfigured] of Object.entries(status)) {
        if (isConfigured) remaining[p] = '••••••••';
      }
      updateWorkspace({ apiKeys: remaining, fundedAvailable, webSearchHosted });
      setConfigured(new Set(Object.keys(remaining)));
      setConfirmRemove(false);
      showToast(m.sw_key_removed({ provider: activeProvider.name }), 'success');
    } catch (err: any) {
      showToast(err.message || m.stk_remove_failed(), 'error');
    } finally {
      setRemovingKey(false);
    }
  };

  return (
    <Modal open onClose={() => onClose(false)} size="xl" overlayOpacity="high" className="p-0 overflow-hidden">
      {/*
        Header — SQEM-417. This was a white block with 1.5px bars and 12px type, which made the first
        screen a new customer ever sees read like a settings dialog. The band is the same dark brand
        gradient the app already uses for the plan card and the marketplace offer tile, so it is a
        pattern the product has rather than a new one invented here.
        SQEM-554 (f1): still a strong band for the first impression, but a flat accent
        surface — redesign C uses no gradients, and the blurred glow went with it.
      */}
      <div className="relative overflow-hidden px-6 py-6 md:px-8 md:py-7 bg-accent-strong text-white">
        <div className="relative">
          <div className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.12em] text-white/80 mb-1.5">
            <Sparkles className="w-3.5 h-3.5" /> {m.sw_getting_started()}
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{m.sw_title()}</h2>
          {/* The why and the outcome live on the welcome screen (round 2) — the header stays a header. */}
          <div className="flex items-center gap-1.5 mt-5">
            {/* `i < step`: the welcome screen sits at index 0 and fills nothing. */}
            {WORK_STEPS.map((s, i) => (
              <div key={s.id} className={`h-1.5 rounded-full flex-1 transition-all duration-500 ${i < step ? 'bg-white' : 'bg-white/25'}`} />
            ))}
          </div>
          <p className="text-xs text-white/85 mt-2.5 font-medium">
            {current === 'welcome' ? m.sw_step_welcome() : current === 'done' ? m.sw_all_done() : m.sw_step_of({ step, total: WORK_STEPS.length, label: STEPS[step].label })}
          </p>
        </div>
      </div>

      {/*
        Body — SQEM-417: `key={current}` remounts on every step change, which is what makes the
        entrance animation fire. Without it React reuses the subtree and the screen swaps hard.
      */}
      <div key={current} className="px-6 py-7 md:px-8 min-h-[320px] animate-step-in">
        {/* ---- Welcome — the why and the outcome, before anything is asked (SQEM-386 round 2) ---- */}
        {current === 'welcome' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-strong tracking-tight">{m.sw_welcome_title()}</h3>
                {/* SQEM-420 — no step count any more. It used to say "two"/"three"; since SQEM-414 the
                    list is built from the channels a person has not chosen yet (self-host 2–4, Cloud
                    2–5), so any number printed here is a guess made before the question is asked. */}
                <p className="text-sm text-ink-muted mt-1 leading-relaxed">
                  {IS_SELF_HOSTED
                    ? m.sw_welcome_selfhost()
                    : m.sw_welcome_cloud()}
                </p>
              </div>
            </div>
            {/* SQEM-417 — the three promises arrive one after the other instead of all at once. The
                delay lives on the item (`--i`), so inserting or dropping one cannot desynchronise it. */}
            <ol className="space-y-2.5">
              {[
                ...(IS_SELF_HOSTED ? [] : [{
                  icon: <Wand2 className="w-4 h-4" />,
                  title: m.sw_w1_title(),
                  sub: m.sw_w1_sub(),
                }]),
                {
                  icon: <Puzzle className="w-4 h-4" />,
                  title: m.sw_w2_title(),
                  sub: m.sw_w2_sub(),
                },
                {
                  icon: <Check className="w-4 h-4" />,
                  title: m.sw_w3_title(),
                  // SQEM-424 — the old line described the mechanism ("no steps for what you did not
                  // pick"). What a person needs to hear before the first question is that none of it
                  // is a commitment.
                  sub: m.sw_w3_sub(),
                },
              ].map((item, i) => (
                <li
                  key={item.title}
                  style={{ '--i': i } as React.CSSProperties}
                  className="animate-stagger flex items-start gap-3 p-3 rounded-2xl border border-line bg-surface-sunken/60"
                >
                  <div className="p-2 rounded-xl bg-surface-field text-accent shadow-sm shrink-0">{item.icon}</div>
                  <div className="text-sm">
                    <p className="font-bold text-ink-strong">{item.title}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{item.sub}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* ---- Provider key ---- */}
        {current === 'provider' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              {/* SQEM-423 — when Chat is what this key is for, the step wears Chat's icon and title.
                  ⛔ When it is NOT (self-host, or Cloud without funded AI and no Chat picked — see
                  SQEM-418), it keeps the key icon and the key title: there the step is about drafting
                  and adapting playbooks, and "In sqemes Chat" would simply be false. */}
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent shrink-0">
                {channels.includes('chat') ? <MessageSquare className="w-5 h-5" /> : <Key className="w-5 h-5" />}
              </div>
              <div>
                {keyMode === 'required' ? (
                  <>
                    <h3 className="text-lg font-bold text-ink-strong tracking-tight">{channels.includes('chat') ? m.sw_ch_chat() : m.sw_key_required_title()}</h3>
                    <p className="text-sm text-ink-muted mt-1 leading-relaxed">
                      {/* SQEM-418 — Chat is named only when it was chosen. Whoever picked the browser
                          alone still needs a key here, but for drafting and adapting playbooks — telling
                          them it is for a Chat they did not ask for is how the step read as pointless. */}
                      {IS_SELF_HOSTED
                        ? (channels.includes('chat') ? m.sw_key_selfhost_chat() : m.sw_key_selfhost_nochat())
                        : (channels.includes('chat') ? m.sw_key_cloud_chat() : m.sw_key_cloud_nochat())}
                    </p>
                  </>
                ) : (
                  <>
                    {/* ⚠️ SQEM-386 put "Optional" in the HEADLINE because two testers read this step as
                        mandatory. SQEM-423 gives the headline to the channel — so the word moves to the
                        front of the sentence, and the green "You can start right away" block below is
                        untouched. Do not drop it from both places. */}
                    <h3 className="text-lg font-bold text-ink-strong tracking-tight">{channels.includes('chat') ? m.sw_ch_chat() : m.sw_key_optional_title()}</h3>
                    <p className="text-sm text-ink-muted mt-1 leading-relaxed">{m.sw_key_optional_body()}</p>
                  </>
                )}
              </div>
            </div>

            {/* SQEM-386 — the reassurance comes FIRST. It used to sit under the provider grid, in
                small type, after a divider — and two testers read the step as mandatory anyway. */}
            {keyMode !== 'required' && (
              <div className="flex items-start gap-3 mb-5 p-4 rounded-2xl bg-success-soft">
                <div className="p-2 rounded-xl bg-surface-raised/70 text-success shrink-0">
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
                      <h3 className="text-lg font-bold text-ink-strong tracking-tight">{m.sw_start_now()}</h3>
                      <p className="text-xs text-ink mt-1 leading-relaxed">
                        {m.sw_credits_included({ credits: creditsIncluded.toLocaleString(getLocale()) })}{' '}
                        {hasByokText
                          ? m.sw_own_key_first()
                          : m.sw_works_without_key()}
                        {' '}<span className="text-ink-subtle">{m.sw_credit_unit()}</span>
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-lg font-bold text-ink-strong tracking-tight">{m.sw_ai_included_title()}</h3>
                      <p className="text-xs text-ink mt-1 leading-relaxed">
                        {m.sw_ai_included_body()}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* One row: provider dropdown (with icons) + input + save */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative sm:w-52 shrink-0" onKeyDown={e => {
                // SQEM-535 — claim Escape while the list is open, so the wizard's dialog does not close too.
                if (e.key === 'Escape' && providerOpen) { e.preventDefault(); setProviderOpen(false); }
              }}>
                <button
                  type="button"
                  onClick={() => setProviderOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={providerOpen}
                  className="w-full flex items-center gap-2 p-2.5 border border-line-strong bg-surface-field rounded-xl text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                >
                  <ProviderIcon provider={provider} className="w-5 h-5 shrink-0" />
                  <span className="flex-1 text-left text-ink-strong truncate">{activeProvider.name}</span>
                  {configured.has(provider) && !keyValue && (
                    <span className="text-2xs bg-success-soft text-ink-strong px-1.5 py-0.5 rounded-md font-bold shrink-0">{m.sta_configured()}</span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-ink-subtle shrink-0 transition-transform ${providerOpen ? 'rotate-180' : ''}`} />
                </button>
                {providerOpen && (
                  <>
                    <button type="button" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setProviderOpen(false)} aria-hidden />
                    <div role="listbox" aria-label={m.sw_ai_provider()} className="absolute z-20 mt-1 w-full bg-surface-raised border border-line-strong rounded-xl shadow-xl overflow-hidden py-1">
                      {PROVIDERS.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          role="option"
                          aria-selected={p.id === provider}
                          onClick={() => { setProvider(p.id); setProviderOpen(false); setConfirmRemove(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-sunken transition-colors ${p.id === provider ? 'bg-accent-soft' : ''}`}
                        >
                          <ProviderIcon provider={p.id} className="w-5 h-5 shrink-0" />
                          <span className="flex-1 text-left text-ink truncate">{p.name}</span>
                          {configured.has(p.id) && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
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
                placeholder={configured.has(provider) ? m.sta_replace_placeholder() : activeProvider.placeholder}
                className="font-mono"
                tone={configured.has(provider) && !keyValue ? 'success' : 'default'}
              />
              <button
                onClick={handleSaveKey}
                disabled={!keyValue.trim() || savingKey}
                className="shrink-0 px-5 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : m.st_save()}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mt-2.5 flex-wrap">
              <a href={activeProvider.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline group/link">
                {m.sw_get_key({ provider: activeProvider.name })} <ExternalLink className="w-3 h-3 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
              </a>

              {/* SQEM-203 — the way back out. Confirmed inline rather than in a second Modal: the
                  wizard is already one, and stacking two dialogs on a first-run screen reads as an
                  error. Hidden while a replacement key is being typed — saving already replaces. */}
              {configured.has(provider) && !keyValue && (
                confirmRemove ? (
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span className="text-ink-muted">{m.sw_remove_saved({ provider: activeProvider.name })}</span>
                    <button
                      type="button"
                      onClick={handleRemoveKey}
                      disabled={removingKey}
                      className="font-bold text-danger hover:opacity-80 transition-colors disabled:opacity-50"
                    >
                      {removingKey ? m.sw_removing() : m.sta_remove()}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="font-bold text-ink-muted hover:text-ink-strong transition-colors"
                    >
                      {m.pb_cancel()}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="text-xs font-bold text-ink-muted hover:text-danger transition-colors"
                  >
                    {m.sw_remove_key()}
                  </button>
                )
              )}
            </div>

          </div>
        )}

        {/* ---- Where to use them (SQEM-414) ---- */}
        {current === 'channels' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-strong tracking-tight">{m.sw_channels_title()}</h3>
                {/* The question exists because the wizard used to answer it for everyone: a tester who
                    works in the ChatGPT desktop app was walked through a browser extension. */}
                <p className="text-sm text-ink-muted mt-1 leading-relaxed">{m.sw_channels_body()}</p>
              </div>
            </div>

            <div className="space-y-2">
              {CHANNELS.map(c => {
                const on = channels.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChannels(prev => (prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id]))}
                    className={`w-full text-left flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
                      on
                        ? 'border-accent bg-accent-soft'
                        : 'border-line-strong hover:border-line-strong'
                    }`}
                  >
                    {on
                      ? <CheckCircle2 className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                      : <Circle className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />}
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
                        <span className={on ? 'text-accent' : 'text-ink-subtle'}>{c.icon}</span>
                        {c.title()}
                      </span>
                      <span className="block text-xs text-ink-muted mt-1 leading-relaxed">{c.text()}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- Desktop apps and code editors (SQEM-414) ---- */}
        {current === 'mcp' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent shrink-0">
                <McpIcon className="w-5 h-5" />
              </div>
              <div>
                {/* ⛔ SQEM-201 removed MCP from onboarding because it was the SECOND screen everyone
                    saw: an unexplained acronym, a raw endpoint and a JSON block. It is back only for
                    people who asked for it, and it leads with the tools, not with the acronym. */}
                {/* SQEM-423 — the card's title. ⚠️ The full client list moved into the line below
                    rather than disappearing: SQEM-201's rule is that this screen leads with tools a
                    person recognises, never with the acronym, and the title still names three. */}
                <h3 className="text-lg font-bold text-ink-strong tracking-tight">{m.sw_ch_mcp()}</h3>
                <p className="text-sm text-ink-muted mt-1 leading-relaxed">{m.sw_mcp_body()}</p>
              </div>
            </div>

            <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-1.5">{m.sw_endpoint()}</p>
            <div className="flex items-center gap-2 bg-surface-sunken border border-line-strong rounded-xl px-3 py-2.5 overflow-hidden">
              <span className="text-xs font-mono text-ink truncate flex-1 min-w-0">{MCP_URL}</span>
              <button
                type="button"
                onClick={async () => { await copyToClipboard(MCP_URL); setMcpCopied(true); setTimeout(() => setMcpCopied(false), 2000); }}
                className="shrink-0 text-ink-subtle hover:text-accent transition-colors"
                title={m.mcp_copy_url()}
              >
                {mcpCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* SQEM-533 — the per-client steps, the same component the Settings card shows. Until then
                this screen deliberately named no client, because nothing here verified which signs in
                and which needs a key; lib/mcpClients.ts now carries that, each entry checked against the
                client's own documentation and linked to it. Compact: the notes live in Settings. */}
            <div className="mt-4">
              <McpClientGuide url={MCP_URL} compact />
            </div>
            <p className="text-xs text-ink-muted mt-3 leading-relaxed">
              {m.sw_mcp_key_1()} <span className="font-semibold text-ink">{m.sw_settings_api()}</span>{m.sw_mcp_key_2()}
            </p>
            <p className="text-2xs text-ink-subtle mt-2">
              {m.sw_mcp_nothing()}
            </p>
          </div>
        )}

        {/* ---- Extension ---- */}
        {current === 'extension' && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              {/* SQEM-423 — the step wears its card's icon and title. Picking "In your browser" and
                  landing on a differently-named screen with a different icon reads as a different
                  subject; the card is the promise, the step is where it is kept. */}
              <div className="p-2.5 rounded-xl bg-accent-soft text-accent shrink-0">
                <Chromium className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-strong tracking-tight">{m.sw_ch_browser()}</h3>
                {/* The WHY, what is missing without it, and that it can wait — all three testers asked
                    "why do I need this?". Round 2 dropped the two 50/50 cards (a wall of logos left, a
                    lone Chrome mark right) for the store badge and two quiet lines. */}
                {/* SQEM-420 — "Sqemes Chat only" predates SQEM-414, which made MCP a channel of its own. */}
                <p className="text-sm text-ink-muted mt-1 leading-relaxed">{m.sw_ext_body()}</p>
              </div>
            </div>

            {/* SQEM-207 (P-03) — installation used to end in silence: the button opened a new tab
                and nothing here ever changed. `useExtensionInstalled` has existed since SQEM-079 and
                the sidebar already used it; the step that asks for the install did not. */}
            {extensionInstalled ? (
              <p className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-success-soft text-success text-sm font-bold">
                <Check className="w-4 h-4" /> {m.sw_ext_installed()}
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
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all shadow-lg"
                >
                  <ChromeWebStoreIcon className="w-4 h-4" /> {m.sw_ext_install()} <ExternalLink className="w-4 h-4" />
                </a>
                {/* Sets the expectation: a new tab opens, and this step notices when they return —
                    `useExtensionInstalled` pings again on focus (round 3).
                    ⛔ SQEM-420 — that promise is Cloud-only and cannot be made true on self-host: the
                    extension's `externally_connectable` lists `https://app.sqemes.com/*` alone, so a page
                    served from any other origin never gets an answer. Chrome accepts no catch-all pattern
                    there, so this is not a manifest fix waiting to happen — it is a property of the
                    platform. What a self-hoster actually needs is the step that Cloud does not have:
                    pointing the extension at this instance (SELF_HOSTING.md → "Chrome extension"). */}
                <p className="text-2xs text-ink-subtle mt-2">
                  {IS_SELF_HOSTED
                    ? <>{m.sw_ext_selfhost_1()} <span className="font-semibold">Instance</span> {m.sw_ext_selfhost_2()}</>
                    : m.sw_ext_cloud()}
                </p>
              </div>
            )}

            <div className="mt-5 space-y-1.5 text-2xs text-ink-muted">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-semibold uppercase tracking-wider text-ink-subtle">{m.sw_works_with()}</span>
                {EXTENSION_LLMS.map(llm => (
                  <span key={llm.label} className="inline-flex items-center gap-1">
                    <ProviderIcon provider={llm.provider} className="w-3.5 h-3.5" /> {llm.label}
                  </span>
                ))}
              </p>
              <p>
                <span className="font-semibold uppercase tracking-wider text-ink-subtle">{m.sw_in()}</span> Chrome, Edge, Brave, Arc, Opera, Vivaldi
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
            // A function in state needs the updater form, or React calls it instead of storing it.
            onBackChange={handler => setStepBack(() => handler)}
          />
        )}

        {/* ---- You're set — a ledger, not a call to action (SQEM-386) ---- */}
        {current === 'done' && (
          <div>
            {/* SQEM-417 — the last screen of the first run says what was achieved before it lists what
                is where. It stays a ledger (SQEM-386): a banner, then the same honest rows. */}
            {/* SQEM-554 (f1) — no gradient; the success hue sits in the background and the icon, the text
                stays dark (white on green misses AA at this size). */}
            <div className="rounded-card bg-success-soft border border-success/30 text-ink-strong p-5 mb-5 flex items-start gap-3.5">
              <div className="p-2 rounded-xl bg-surface-raised text-success shrink-0"><CheckCircle2 className="w-6 h-6" /></div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">
                  {createdCount > 0
                    ? m.sw_ready_n({ count: createdCount })
                    : m.sw_ws_ready()}
                </h3>
                <p className="text-sm text-ink mt-1 leading-relaxed">
                  {channelSummary
                    ? m.sw_work_in({ channels: channelSummary })
                    : m.sw_stands()}
                </p>
              </div>
            </div>
            <ul className="space-y-3">
              {/* Templates */}
              <li className="flex items-start gap-3">
                {createdCount > 0
                  ? <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold text-ink-strong">{m.nav_playbooks()}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {createdCount > 0
                      ? <>{m.sw_created_1({ count: createdCount })} <Link to="/playbooks" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.nav_playbooks()}</Link>.</>
                      : <>{m.sw_none_1()} <Link to="/playbooks/new" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_editor()}</Link>{m.sw_none_2()} <Link to="/playbooks" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_import()}</Link>{m.sw_none_3()} <Link to="/library" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.mk_title()}</Link>.</>}
                    {/* Round 2 (owner): promote the wizards where the person is — the ledger. */}
                    {!IS_SELF_HOSTED && <>{m.sw_another_1()} <Link to="/playbooks" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.pb_wizard()}</Link> {m.sw_another_2()}</>}
                  </p>
                </div>
              </li>
              {/* Extension — SQEM-414: only for someone who said they work in a browser. Showing it
                  to everyone is what put a desktop-app user in front of an extension he cannot use. */}
              {channels.includes('browser') && (
              <li className="flex items-start gap-3">
                {extensionInstalled
                  ? <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold text-ink-strong">{m.sw_ext_row()}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {extensionInstalled
                      ? m.sw_ext_row_installed()
                      : IS_SELF_HOSTED
                        // SQEM-420 — "Not yet" would be a claim this instance cannot check (see the
                        // extension step): the ping never reaches a self-hosted origin.
                        ? <>{m.sw_ext_row_selfhost()} <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">Chrome Web Store</a> {m.sw_ext_row_selfhost_2()}</>
                        : <>{m.sw_ext_row_notyet()} <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">Chrome Web Store</a>.</>}
                  </p>
                </div>
              </li>
              )}
              {/* Desktop apps and code editors — SQEM-414. There is nothing to verify from here: the
                  connecting happens inside the other tool, so this row points rather than judges. */}
              {channels.includes('mcp') && (
                <li className="flex items-start gap-3">
                  {/* SQEM-425 — an EMPTY CHECKBOX was wrong here: it could never be ticked (SQEM-414 hard-
                      coded it), so next to rows that do tick it read as a task you never get done. Two
                      honest states instead: the MCP mark as a signpost, and a real check once a tool has
                      actually called this workspace (`last_used_at` on the key it authenticated with). */}
                  {mcpConnected
                    ? <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                    : <McpIcon className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />}
                  <div className="text-sm">
                    <p className="font-semibold text-ink-strong">{m.sw_mcp_row()}</p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {mcpConnected
                        ? <>{m.sw_mcp_row_connected()} <Link to="/settings" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_settings_api()}</Link>.</>
                        : <>{m.sw_mcp_row_add()} <Link to="/settings" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_settings_api()}</Link>.</>}
                    </p>
                  </div>
                </li>
              )}
              {/* sqemes Chat — SQEM-423: ONE row, not two. It used to be a "sqemes Chat" row saying it
                  was ready and an "AI in sqemes Chat" row underneath saying where the AI comes from:
                  the same subject twice, one after the other. Ready and powered-by belong together. */}
              {channels.includes('chat') && (
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-ink-strong">{m.sw_chat_row()}</p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {m.sw_chat_ready_1()} <Link to="/chat" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.nav_chat()}</Link> {m.sw_chat_ready_2()}{' '}
                      {configured.size > 0
                        ? m.sw_chat_own_key()
                        : keyMode === 'credits'
                          ? <>{m.sw_chat_credits()} <Link to="/settings" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_settings_api()}</Link>.</>
                          : keyMode === 'included'
                            ? m.sw_chat_included()
                            : <>{m.sw_chat_needs_key()} <Link to="/settings" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_settings_api()}</Link>.</>}
                    </p>
                  </div>
                </li>
              )}
              {/* AI key — SQEM-418 decided WHEN this row exists, SQEM-423 narrowed it further: with Chat
                  chosen the Chat row above already says where the AI comes from, so this row is only for
                  the case that is NOT about Chat — an instance where nothing AI-powered runs without a
                  key (`required`). Everywhere else there is nothing here worth a line. */}
              {!channels.includes('chat') && keyMode === 'required' && (
              <li className="flex items-start gap-3">
                {configured.size > 0
                  ? <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  : <Circle className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold text-ink-strong">{m.sw_ai_row()}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {configured.size > 0
                      ? m.sw_ai_row_set()
                      : <>{m.sw_ai_row_notyet()} <Link to="/settings" onClick={closeOnly} className="font-semibold text-accent hover:underline">{m.sw_settings_api()}</Link>.</>}
                  </p>
                </div>
              </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 md:px-8 border-t border-line flex items-center justify-between gap-3">
        {current === 'done' ? (
          <span />
        ) : step > 0 ? (
          <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink-strong transition-colors">
            <ArrowLeft className="w-4 h-4" /> {m.sw_back()}
          </button>
        ) : (
          // SQEM-386 — this closes the WHOLE wizard, and the old label ("I'll do this later") did not
          // say so next to a step-level "Skip". A tester feared losing the step for good. The way back
          // is named: the dashboard banner reopens it.
          <button onClick={() => onClose(false)} className="text-sm font-semibold text-ink-muted hover:text-ink-strong transition-colors">
            {m.sw_later()}
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
                <button onClick={next} className={MUTED_BTN}>{m.sw_skip()}</button>
              )}
              {createAction ? (
                (!createAction.disabled || createAction.loading) && (
                  <button onClick={createAction.onClick} disabled={createAction.loading} className={PRIMARY_BTN}>
                    {createAction.loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {createAction.label}
                  </button>
                )
              ) : (
                <button onClick={next} className={MUTED_BTN}>{m.sw_skip()} <ArrowRight className="w-4 h-4" /></button>
              )}
            </>
          ) : current === 'welcome' ? (
            <button onClick={next} className={PRIMARY_BTN}>{m.sw_lets_go()} <ArrowRight className="w-4 h-4" /></button>
          ) : current === 'done' ? (
            <button onClick={finish} className={PRIMARY_BTN}>{m.sw_done()}</button>
          ) : (
            <button onClick={next} className={stepDone[current] ? PRIMARY_BTN : MUTED_BTN}>
              {stepDone[current] ? m.sw_next() : m.sw_skip()} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SetupWizard;
