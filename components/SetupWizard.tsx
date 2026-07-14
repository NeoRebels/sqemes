import { useState } from 'react';
import { useWorkspace, useUI } from '../store';
import { saveApiKey } from '../lib/api/apiKeys';
import { supabase } from '../lib/supabase';
import { PLANS } from '../constants';
import { ProviderIcon } from './ProviderIcon';
import WizardCreateStep, { type WizardAction } from './WizardCreateStep';
import Modal from './ui/Modal';
import {
  Key, Server, Puzzle, Check, Copy, ExternalLink, Loader2, ArrowRight, ArrowLeft, Sparkles, Lock, ChevronDown,
} from 'lucide-react';
import chromeSrc from '../assets/browsers/chrome.svg';
import edgeSrc from '../assets/browsers/edge.svg';
import braveSrc from '../assets/browsers/brave.svg';
import operaSrc from '../assets/browsers/opera.svg';
import vivaldiSrc from '../assets/browsers/vivaldi.svg';
import arcSrc from '../assets/browsers/arc.svg';
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

const BROWSERS = [
  { label: 'Chrome', src: chromeSrc },
  { label: 'Edge', src: edgeSrc },
  { label: 'Brave', src: braveSrc },
  { label: 'Arc', src: arcSrc },
  { label: 'Opera', src: operaSrc },
  { label: 'Vivaldi', src: vivaldiSrc },
];

const STEPS = ['Provider key', 'MCP', 'Extension', 'Create templates'];

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
  const hasMcpAccess = workspace.isManaged || PLANS[workspace.plan]?.mcpAccess;

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
  const activeProvider = PROVIDERS.find(p => p.id === provider) ?? PROVIDERS[0];

  const handleSaveKey = async () => {
    const trimmed = keyValue.trim();
    if (!trimmed) return;
    setSavingKey(true);
    try {
      await saveApiKey(workspace.id, provider, trimmed);
      setConfigured(prev => new Set(prev).add(provider));
      // Sync the store so later steps (Step 4 generation gate) see the new key.
      updateWorkspace({ apiKeys: { ...workspace.apiKeys, [provider]: '••••••••' } });
      setKeyValue('');
      showToast(`${activeProvider.name} key saved`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save key', 'error');
    } finally {
      setSavingKey(false);
    }
  };

  // --- MCP state ---
  const mcpUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-server`;
  const plansUrl = `${window.location.origin}${window.location.pathname}#/settings?tab=plans`;
  const [generatingMcp, setGeneratingMcp] = useState(false);
  const [mcpKey, setMcpKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const snippet = `{\n  "mcpServers": {\n    "sqemes": {\n      "url": "${mcpUrl}",\n      "headers": {\n        "Authorization": "Bearer ${mcpKey ?? 'sqm_live_YOUR_KEY'}"\n      }\n    }\n  }\n}`;

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleGenerateMcpKey = async () => {
    setGeneratingMcp(true);
    try {
      const randomBytes = crypto.getRandomValues(new Uint8Array(16));
      const hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const key = `sqm_live_${hex}`;
      const keyPrefix = key.substring(0, 16) + '...';
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      const { error } = await supabase.from('sqemes_api_keys').insert({
        workspace_id: workspace.id,
        name: 'Setup wizard',
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: ['read', 'create', 'update', 'delete'],
        expires_at: null,
      });
      if (error) throw error;
      setMcpKey(key);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate key', 'error');
    } finally {
      setGeneratingMcp(false);
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
          {STEPS.map((label, i) => (
            <div key={label} className={`h-1.5 rounded-full flex-1 transition-colors ${i <= step ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 font-medium">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
      </div>

      {/* Body */}
      <div className="px-6 py-6 md:px-8 min-h-[320px]">
        {/* ---- Step 1: Provider key ---- */}
        {step === 0 && (
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
                          onClick={() => { setProvider(p.id); setProviderOpen(false); }}
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
            <a href={activeProvider.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline mt-2.5 group/link">
              Get a {activeProvider.name} key <ExternalLink className="w-3 h-3 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
            </a>
          </div>
        )}

        {/* ---- Step 2: MCP ---- */}
        {step === 1 && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Connect via MCP</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Use your full template library inside Claude Desktop, Cursor, and other MCP clients.</p>
              </div>
            </div>

            {!hasMcpAccess ? (
              <div className="flex flex-col items-center justify-center text-center gap-3 py-10 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">MCP is available on Team & Business</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs">Upgrade to connect Claude Desktop, Cursor, and other MCP clients to your library.</p>
                </div>
                <a href={plansUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none">
                  Upgrade plan <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Endpoint URL</p>
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 overflow-hidden">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate flex-1 min-w-0">{mcpUrl}</span>
                    <button onClick={() => copy(mcpUrl, 'url')} className="shrink-0 text-slate-400 hover:text-brand-500 transition-colors" title="Copy URL">
                      {copied === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {mcpKey && (
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Your new key</p>
                    <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl px-3 py-2.5">
                      <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 truncate flex-1">{mcpKey}</span>
                      <button onClick={() => copy(mcpKey, 'mcpkey')} className="shrink-0 text-emerald-600 hover:text-emerald-700" title="Copy key">
                        {copied === 'mcpkey' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-2xs text-amber-600 dark:text-amber-400 mt-1">Copy this now — it won't be shown again.</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Client Config (Claude Desktop / Cursor)</p>
                  <div className="relative bg-slate-900 dark:bg-slate-950 rounded-xl p-4">
                    <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre">{snippet}</pre>
                    <button onClick={() => copy(snippet, 'snippet')} className="absolute top-3 right-3 p-1.5 text-slate-500 hover:text-slate-200 transition-colors" title="Copy snippet">
                      {copied === 'snippet' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {!mcpKey && (
                  <button
                    onClick={handleGenerateMcpKey}
                    disabled={generatingMcp}
                    className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {generatingMcp ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : 'Generate Key'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---- Step 3: Extension ---- */}
        {step === 2 && (
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 shrink-0">
                <Puzzle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Install the browser extension</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pull any template into the AI you're already using — pick a template, fill in the variables, and it's inserted straight into the chat box. No copy-paste.</p>
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

              {/* Works on */}
              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-2xl p-4">
                <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-3">Works on Chromium browsers</p>
                <div className="grid grid-cols-3 gap-3">
                  {BROWSERS.map(b => (
                    <div key={b.label} className="flex flex-col items-center gap-1.5">
                      <IconTile><img src={b.src} className="w-5 h-5" alt={b.label} /></IconTile>
                      <span className="text-2xs font-semibold text-slate-600 dark:text-slate-300 text-center">{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all"
            >
              Install from Chrome Web Store <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        {/* ---- Step 4: Create templates ---- */}
        {step === 3 && <WizardCreateStep onComplete={() => onClose(true)} onConnectKey={() => setStep(0)} onActionChange={setCreateAction} />}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 md:px-8 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button onClick={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        ) : (
          <button onClick={() => onClose(false)} className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            I'll do this later
          </button>
        )}

        <div className="flex items-center gap-2">
          {isLast ? (
            <>
              <button onClick={() => onClose(true)} className="px-4 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                Skip for now
              </button>
              {createAction && (
                <button
                  onClick={createAction.onClick}
                  disabled={createAction.disabled}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-200 dark:shadow-none"
                >
                  {createAction.loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {createAction.label}
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={next} className="px-4 py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                Skip
              </button>
              <button onClick={next} className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none">
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SetupWizard;
