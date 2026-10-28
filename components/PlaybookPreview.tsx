import React from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Copy, Edit, FolderDown, Play, Star, Store, Trash2 } from 'lucide-react';
import KindBadge from './ui/KindBadge';
import AccessBadge from './ui/AccessBadge';
import TagEditor from './ui/TagEditor';
import type { AccessBadgeMode } from '../lib/accessBadge';
import { IS_SELF_HOSTED } from '../lib/env';
import type { Prompt } from '../types';
import { m as txt } from '../lib/i18n'; // SQEM-605 — `m` is a loop variable here

/**
 * SQEM-550 (b) — the right half of the Playbooks page (redesign C): the selected playbook's title and
 * description, which persona loads it, its blanks, and every action the old card carried.
 *
 * ⛔ The card's actions all live here now — Edit, Duplicate, Download (.sqemes.zip), Publish to
 * Marketplace, Delete (set apart, SQEM-539) — plus "Use now". `tests/unit/playbooksPreview.test.ts`
 * lists them: losing one in a redesign is the failure this split is most likely to cause.
 */
export type LoadedBy = { id: string; title: string; condition: string };

/** `{{name}}` blanks, in order of first appearance. */
export function blanksIn(content: string): string[] {
  const seen: string[] = [];
  for (const m of content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

const ACTION = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-control text-sm font-medium text-ink-muted hover:text-ink-strong hover:bg-surface-sunken transition-colors';

export default function PlaybookPreview({
  prompt, canEdit, accessMode, workspaceTags, loadedBy, showPublish,
  onUse, onDuplicate, onExport, onPublish, onDelete, onSetTag, onFavorite, onBack,
}: {
  prompt: Prompt;
  canEdit: boolean;
  accessMode?: AccessBadgeMode;
  workspaceTags: string[];
  loadedBy: LoadedBy[];
  showPublish: boolean;
  onUse: (prompt: Prompt) => void;
  onDuplicate: (prompt: Prompt) => void;
  onExport: (prompt: Prompt) => void;
  onPublish: (prompt: Prompt) => void;
  onDelete: (id: string) => void;
  onSetTag: (prompt: Prompt, tag: string | null) => void;
  onFavorite: (prompt: Prompt) => void;
  /** Below `lg` the preview replaces the list; this goes back to it. */
  onBack: () => void;
}) {
  const blanks = prompt.kind === 'prompt' ? blanksIn(prompt.content) : [];
  return (
    <article aria-labelledby="playbook-preview-title" className="rounded-card border border-line bg-surface-raised p-5 md:p-6">
      <button type="button" onClick={onBack} className="lg:hidden mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink-strong">
        <ArrowLeft className="w-4 h-4" /> {txt.pv_all_playbooks()}
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <KindBadge kind={prompt.kind} />
            <TagEditor
              tags={prompt.tag ? [prompt.tag] : []}
              available={canEdit && !prompt.tag ? workspaceTags : []}
              canEdit={canEdit}
              onAdd={(tag) => onSetTag(prompt, tag)}
              onRemove={() => onSetTag(prompt, null)}
            />
            {accessMode && <AccessBadge mode={accessMode} />}
          </div>
          <h2 id="playbook-preview-title" className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-strong break-words">{prompt.title}</h2>
          {prompt.description && <p className="mt-1 text-ink-muted">{prompt.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onFavorite(prompt)}
            aria-pressed={!!prompt.isFavorite}
            aria-label={prompt.isFavorite ? txt.pv_unfavourite() : txt.pv_favourite()}
            className="p-2 rounded-control text-ink-subtle hover:text-amber-400 transition-colors"
          >
            <Star className={`w-5 h-5 ${prompt.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          {canEdit && (
            <Link to={`/playbooks/${prompt.id}/edit`} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control border border-line-strong bg-surface-raised text-sm font-semibold text-ink-strong hover:bg-surface-sunken transition-colors">
              <Edit className="w-4 h-4" /> {txt.pv_edit()}
            </Link>
          )}
          <button type="button" onClick={() => onUse(prompt)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent-strong text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            <Play className="w-4 h-4" /> {txt.pv_use_now()}
          </button>
        </div>
      </div>

      {/* SQEM-550 (b) follow-up — no copy of the content here (it added nothing in use);
          the editor is one click away via Edit. What the preview adds is what the content does not
          say: who loads it, and which blanks it asks for. */}
      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card bg-surface-sunken p-4">
          <dt className="text-2xs font-bold uppercase tracking-wider text-ink-subtle mb-1.5">{txt.pv_loaded_by()}</dt>
          <dd className="text-sm text-ink">
            {loadedBy.length === 0 ? <span className="text-ink-muted">{txt.pv_no_persona()}</span> : (
              <ul className="space-y-1">
                {loadedBy.map(p => (
                  <li key={p.id}><span className="font-semibold text-ink-strong">{p.title}</span>{p.condition && <span className="text-ink-muted"> — {p.condition}</span>}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div className="rounded-card bg-surface-sunken p-4">
          <dt className="text-2xs font-bold uppercase tracking-wider text-ink-subtle mb-1.5">{prompt.kind === 'prompt' ? txt.pv_blanks() : txt.pv_applied_as()}</dt>
          <dd className="text-sm text-ink">
            {prompt.kind === 'skill'
              ? txt.pv_skill_knowledge()
              : blanks.length === 0 ? <span className="text-ink-muted">{txt.pv_no_blanks()}</span> : blanks.join(' · ')}
          </dd>
        </div>
      </dl>

      {canEdit && (
        <div className="mt-4 pt-4 border-t border-line flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => onDuplicate(prompt)} className={ACTION}><Copy className="w-4 h-4" /> {txt.pv_duplicate()}</button>
          <button type="button" onClick={() => onExport(prompt)} className={ACTION} title={txt.pv_download_title()}><FolderDown className="w-4 h-4" /> {txt.pv_download()}</button>
          {showPublish && (
            <button type="button" onClick={() => onPublish(prompt)} className={ACTION}>
              <Store className="w-4 h-4" /> {IS_SELF_HOSTED ? txt.pv_submit_marketplace() : txt.pv_publish_marketplace()}
            </button>
          )}
          {/* SQEM-539 — set apart from the everyday actions, so it is not the one hit by accident. */}
          <span className="ml-auto pl-2 border-l border-line">
            <button type="button" onClick={() => onDelete(prompt.id)} className={`${ACTION} hover:text-danger`}><Trash2 className="w-4 h-4" /> {txt.pv_delete()}</button>
          </span>
        </div>
      )}
    </article>
  );
}
