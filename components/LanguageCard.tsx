import React, { useId, useState } from 'react';
import Card from './ui/Card';
import SettingsCardHeader, { SETTINGS_FIELD_LABEL } from './ui/SettingsCardHeader';
import CardSaveBar from './ui/CardSaveBar';
import { m, GERMAN_RELEASED, LOCALES, type Locale } from '../lib/i18n';
import Select from './ui/Select';

/**
 * SQEM-600 — one card for both language settings: the workspace default (Settings → General,
 * admins) and the personal override (Settings → My Profile, where `null` means "follow the workspace").
 *
 * ⭐ **A native select, the same field as "Default AI model" directly below it in General** (label
 * above, `max-w-md`, save bar). The first version used full-width option cards — the "Who can edit"
 * pattern — and was wrong for this: those cards are wide because each carries an explanation, a
 * language is one word, and the list grows with every language. A select scales to any number,
 * opens the system picker on a phone, and needs no work for keyboard or screen reader.
 *
 * Saving changes the language in effect, and `useApplyLocale` then reloads the page in it — so there is
 * no optimistic "now German" state to keep in sync here.
 */

/**
 * Each language in its own language, so someone who cannot read the current one still finds theirs.
 * Typed per locale: a language added to project.inlang without its name fails the type check here.
 */
const LANGUAGE_NAME: Record<Locale, () => string> = { en: m.language_name_en, de: m.language_name_de };

/** The `<option>` value standing for `null` ("follow the workspace"). */
const FOLLOW_WORKSPACE = '';

interface Props<V extends Locale | null> {
  title: string;
  description: string;
  value: V;
  /** The choices in order. `null` is offered only by the profile ("Workspace default"). */
  options: readonly V[];
  /** Shown for the `null` option: the workspace's language, so the choice says what it means. */
  workspaceLanguage?: Locale;
  onSave: (value: V) => Promise<void>;
}

export default function LanguageCard<V extends Locale | null>({ title, description, value, options, workspaceLanguage, onSave }: Props<V>) {
  const id = useId();
  const [draft, setDraft] = useState<{ value: V } | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = draft ? draft.value : value;
  const label = (v: V) => v === null
    ? m.settings_language_follow_workspace({ language: LANGUAGE_NAME[workspaceLanguage ?? 'en']() })
    : LANGUAGE_NAME[v as Locale]();
  const fromOption = (raw: string) => options.find(v => (v ?? FOLLOW_WORKSPACE) === raw) as V;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try { await onSave(draft.value); setDraft(null); } finally { setSaving(false); }
  };

  return (
    <Card className="p-6 md:p-8">
      <SettingsCardHeader title={title} description={description} />
      <label htmlFor={id} className={SETTINGS_FIELD_LABEL}>{m.settings_language_field_label()}</label>
      <Select
        id={id}
        value={selected ?? FOLLOW_WORKSPACE}
        onChange={e => { const v = fromOption(e.target.value); setDraft(v === value ? null : { value: v }); }}
        className="max-w-md"
      >
        {options.map(v => <option key={v ?? 'workspace'} value={v ?? FOLLOW_WORKSPACE}>{label(v)}</option>)}
      </Select>
      {!GERMAN_RELEASED && <p className="mt-2 text-2xs text-ink-subtle max-w-md">{m.settings_language_preview_note()}</p>}
      <CardSaveBar dirty={draft !== null} saving={saving} onCancel={() => setDraft(null)} onSave={save} />
    </Card>
  );
}

/** The workspace offers the languages; the profile offers "follow the workspace" first. */
export const WORKSPACE_LANGUAGE_OPTIONS: readonly Locale[] = LOCALES;
export const PROFILE_LANGUAGE_OPTIONS: readonly (Locale | null)[] = [null, ...LOCALES];
