import React from 'react';
import { Sparkles, AlertTriangle, KeyRound } from 'lucide-react';
import Card from './ui/Card';
import { buildEnabledModels, isImageModel } from '../lib/enabledModels';
import { authoringModelState } from '../lib/authoringAI';
import type { Workspace } from '../types';

/**
 * SQEM-311 — choose the model that does AI *authoring*.
 *
 * Before this existed the model was whichever entry in `AVAILABLE_MODELS` came first and had a key.
 * That is list order — the list is sorted by provider (SQEM-278), not by how well a model writes —
 * and a workspace with three keys could neither see which one it got nor change it, except by
 * deleting keys.
 *
 * ⛔ **It lives under General although the API keys live in another tab, by the owner's decision.**
 * That split has a cost and this card has to pay it: the list can only offer models whose provider
 * has a key, so without a word of explanation an empty or short list here looks like a bug in the
 * picker rather than a missing key one tab over. Hence the empty state points at the tab by name.
 * ⚠️ **Do not replace it with a disabled `<select>`** — a greyed-out control states that there is
 * nothing to choose, which is false; there is something to do first.
 */
export default function AuthoringModelCard({
  workspace,
  onChange,
  onOpenApiKeys,
}: {
  workspace: Workspace;
  onChange: (modelId: string | null) => void;
  onOpenApiKeys: () => void;
}) {
  // No funded option here on purpose. Funded is not a *choice* — it is what happens when there is
  // no BYOK key at all, and the server picks the model. Offering it would imply control we do not
  // have (see `authoringModelState`, case 3).
  const models = buildEnabledModels(workspace.apiKeys, workspace.openrouterModels).filter(m => !isImageModel(m.id));
  const state = authoringModelState(workspace);
  const effective = models.find(m => m.id === state.effectiveId);

  return (
    <Card className="p-6 md:p-8">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-brand-600 dark:text-brand-400" />
        AI for authoring
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Used when Sqemes writes for you — enhancing a prompt, generating a description, the setup and
        template wizards, and adapting a template to your brand. It does not affect Chat, where you pick
        the model each time.
      </p>

      {models.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
          <KeyRound className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              There is nothing to choose yet — a model can only be offered here once its provider has an
              API key.
            </p>
            <button
              onClick={onOpenApiKeys}
              className="mt-2 text-sm font-bold text-brand-600 dark:text-brand-400 hover:underline"
            >
              Add a provider key in the API tab →
            </button>
          </div>
        </div>
      ) : (
        <>
          <label htmlFor="authoring-model" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
            Model
          </label>
          <select
            id="authoring-model"
            value={state.chosenId ?? ''}
            onChange={e => onChange(e.target.value || null)}
            className="w-full max-w-md p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
          >
            <option value="">
              Automatic{effective ? ` — currently ${effective.name}` : ''}
            </option>
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          {/* The two ordinary ways a saved choice stops applying — a retired model, a deleted key —
              look identical from outside: it simply used something else. Saying so is the whole
              point; a silent fallback would recreate the problem this setting exists to fix. */}
          {state.status === 'unavailable' && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 max-w-md">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <span className="font-semibold">{state.chosenId}</span> can&apos;t be used right now — it
                was either retired or its provider key was removed.{' '}
                {effective ? <>Authoring is running on <span className="font-semibold">{effective.name}</span> until you pick another.</> : null}
              </p>
            </div>
          )}

          {state.status === 'auto' && (
            <p className="mt-2 text-2xs text-slate-400 dark:text-slate-500 max-w-md">
              Automatic takes the first model with a key, in the order the catalogue happens to list
              them — pick one explicitly if that matters to you.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
