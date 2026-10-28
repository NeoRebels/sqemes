import React, { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle, KeyRound } from 'lucide-react';
import Card from './ui/Card';
import CardSaveBar from './ui/CardSaveBar';
import { buildEnabledModels, isImageModel } from '../lib/enabledModels';
import { authoringModelState } from '../lib/authoringAI';
import type { Workspace } from '../types';
import Select from './ui/Select';
import { m as txt } from '../lib/i18n'; // SQEM-608 — `m` is the model in a loop here

/**
 * SQEM-311 — choose the model that does AI *authoring*. SQEM-577 — and the default model of a new chat;
 * the card is titled "Default AI model" since then. The field is still `authoringModelId`.
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
  onSave,
  onDirtyChange,
  onOpenApiKeys,
}: {
  workspace: Workspace;
  /** SQEM-539 — called by the card's Save button, never by choosing in the list. */
  onSave: (modelId: string | null) => Promise<void> | void;
  /** Lets Settings ask before a tab change throws an unsaved choice away. */
  onDirtyChange?: (dirty: boolean) => void;
  onOpenApiKeys: () => void;
}) {
  // No funded option here on purpose. Funded is not a *choice* — it is what happens when there is
  // no BYOK key at all, and the server picks the model. Offering it would imply control we do not
  // have (see `authoringModelState`, case 3).
  const models = buildEnabledModels(workspace.apiKeys, workspace.openrouterModels).filter(m => !isImageModel(m.id));
  const state = authoringModelState(workspace);
  const effective = models.find(m => m.id === state.effectiveId);
  // SQEM-539 — the choice is a draft until Save; `undefined` = untouched.
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== undefined && draft !== (state.chosenId ?? null);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try { await onSave(draft ?? null); setDraft(undefined); } finally { setSaving(false); }
  };

  return (
    <Card className="p-6 md:p-8">
      <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-accent" />
        {txt.am_title()}
      </h2>
      {/* SQEM-577 — one default for both: new chats start with it (switchable per chat), and every
          place where sqemes writes for you uses it. Before, the card was about authoring only and left Chat alone. */}
      <p className="text-sm text-ink-muted mb-6">
        {txt.am_desc()}
      </p>

      {models.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface-sunken px-4 py-3">
          <KeyRound className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-ink">
              {txt.am_none()}
            </p>
            <button
              onClick={onOpenApiKeys}
              className="mt-2 text-sm font-bold text-accent hover:underline"
            >
              {txt.am_add_key()}
            </button>
          </div>
        </div>
      ) : (
        <>
          <label htmlFor="authoring-model" className="block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2">
            {txt.am_model()}
          </label>
          <Select
            id="authoring-model"
            value={(draft !== undefined ? draft : state.chosenId) ?? ''}
            onChange={e => setDraft(e.target.value || null)}
            className="max-w-md"
          >
            <option value="">
              {effective ? txt.am_automatic_current({ name: effective.name }) : txt.am_automatic()}
            </option>
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>

          {/* The two ordinary ways a saved choice stops applying — a retired model, a deleted key —
              look identical from outside: it simply used something else. Saying so is the whole
              point; a silent fallback would recreate the problem this setting exists to fix. */}
          {state.status === 'unavailable' && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 max-w-md">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-ink">
                <span className="font-semibold">{state.chosenId}</span> {txt.am_unavailable()}{' '}
                {effective ? <>{txt.am_running_1()} <span className="font-semibold">{effective.name}</span>{txt.am_running_2()}</> : null}
              </p>
            </div>
          )}

          {state.status === 'auto' && (
            <p className="mt-2 text-2xs text-ink-subtle max-w-md">
              {txt.am_auto_hint()}
            </p>
          )}

          <CardSaveBar dirty={dirty} saving={saving} onSave={save} onCancel={() => setDraft(undefined)} />
        </>
      )}
    </Card>
  );
}
