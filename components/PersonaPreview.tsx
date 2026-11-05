import { Link } from 'react-router';
import { ArrowLeft, Copy, Edit, FolderDown, Play, Star, Trash2 } from 'lucide-react';
import AccessBadge from './ui/AccessBadge';
import OwnerLine from './OwnerLine';
import type { OwnerMember } from '../lib/listFilters';
import TagEditor from './ui/TagEditor';
import type { AccessBadgeMode } from '../lib/accessBadge';
import type { Persona } from '../types';
import ServiceLogo from './ServiceLogo';
import type { Connector } from '../lib/api/connectors';
import { resolvePersonaConnectors } from '../supabase/functions/_shared/connectorService';
import { m } from '../lib/i18n';

/**
 * SQEM-554 (b) — the right half of the Personas page (redesign C, the same split as the Playbooks
 * page, SQEM-550 b): the selected persona's title and description, the playbooks it loads and when,
 * and every action the old card carried.
 *
 * "Loads" lists ALL routes in their order, each with its "If" condition — the card showed three and a count. That list is what a
 * persona *is*; the role text is not shown (as for the playbook content: the
 * editor is one click away).
 *
 * "Use now" opens the persona in Chat (`/personas/:id`, which redirects there) — the same words as on
 * a playbook, because both also work over MCP and the button should not name one channel.
 *
 * ⛔ `tests/unit/personasPreview.test.ts` lists the former card's actions: losing one in a redesign is
 * the failure this split is most likely to cause.
 */
const ACTION = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-control text-sm font-medium text-ink-muted hover:text-ink-strong hover:bg-surface-sunken transition-colors';

export default function PersonaPreview({
  persona, canEdit, accessMode, workspaceTags, visiblePlaybookIds, members, connectors, currentUserId,
  onDuplicate, onExport, onDelete, onSetTag, onFavorite, onBack,
}: {
  persona: Persona;
  canEdit: boolean;
  accessMode?: AccessBadgeMode;
  workspaceTags: string[];
  /** Playbooks the viewer can open — only those become links. */
  visiblePlaybookIds: ReadonlySet<string>;
  /** SQEM-620 — to name the owner in the Info box. */
  members: ReadonlyArray<OwnerMember & { avatar?: string | null }>;
  /**
   * SQEM-643 — the viewer's connectors, to say which of the persona's services they have not connected.
   * `null` while not loaded (or failed): then nothing is marked, rather than everything.
   */
  connectors: Connector[] | null;
  currentUserId: string;
  onDuplicate: (persona: Persona) => void;
  onExport: (persona: Persona) => void;
  onDelete: (persona: Persona) => void;
  onSetTag: (persona: Persona, tag: string | null) => void;
  onFavorite: (persona: Persona) => void;
  /** Below `lg` the preview replaces the list; this goes back to it. */
  onBack: () => void;
}) {
  const routes = [...persona.routes].sort((a, b) => a.sortOrder - b.sortOrder);
  const services = persona.connectors ?? [];
  const missingKeys = new Set(
    connectors ? resolvePersonaConnectors(services, connectors, currentUserId).missing.map(s => s.key) : [],
  );
  return (
    <article aria-labelledby="persona-preview-title" className="rounded-card border border-line bg-surface-raised p-5 md:p-6 [container-type:inline-size]">
      <button type="button" onClick={onBack} className="lg:hidden mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink-strong">
        <ArrowLeft className="w-4 h-4" /> {m.ppv_all_personas()}
      </button>

      {/* SQEM-630 — the title and the actions side by side only when the PREVIEW is wide enough (40rem),
          not the window: beside the list and the sidebar it was ~70 px at 768 and ~210 px at 1280, and the
          title broke one letter per line next to the buttons. Window breakpoints were tried first and
          measured wrong at 768 and 1280. The article is the container (`[container-type:inline-size]`);
          Tailwind 3.4 writes the query as an arbitrary variant, no plugin needed. */}
      <div className="flex flex-col gap-4 justify-between [@container(min-width:40rem)]:flex-row [@container(min-width:40rem)]:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <TagEditor
              tags={persona.tags.slice(0, 1)}
              available={canEdit && persona.tags.length === 0 ? workspaceTags : []}
              canEdit={canEdit}
              onAdd={tag => onSetTag(persona, tag)}
              onRemove={() => onSetTag(persona, null)}
            />
            {/* SQEM-330 — the same badge, in the same words, as a restricted playbook. */}
            <AccessBadge mode={accessMode} />
          </div>
          <h2 id="persona-preview-title" className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-strong break-words">{persona.title}</h2>
          {persona.description && <p className="mt-1 text-ink-muted">{persona.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => onFavorite(persona)}
            aria-pressed={!!persona.isFavorite}
            aria-label={persona.isFavorite ? m.pv_unfavourite() : m.pv_favourite()}
            className="p-2 rounded-control text-ink-subtle hover:text-amber-400 transition-colors"
          >
            <Star className={`w-5 h-5 ${persona.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          {canEdit && (
            <Link to={`/personas/${persona.id}/edit`} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control border border-line-strong bg-surface-raised text-sm font-semibold text-ink-strong hover:bg-surface-sunken transition-colors">
              <Edit className="w-4 h-4" /> {m.pv_edit()}
            </Link>
          )}
          {/* SQEM-389 — opens the persona in Chat; the route redirects there. */}
          <Link to={`/personas/${persona.id}`} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent-strong text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            <Play className="w-4 h-4" /> {m.pv_use_now()}
          </Link>
        </div>
      </div>

      <section aria-labelledby="persona-preview-loads" className="mt-5 rounded-card bg-surface-sunken p-4">
        <h3 id="persona-preview-loads" className="text-2xs font-bold uppercase tracking-wider text-ink-subtle mb-2">
          {m.ppv_loads()} {routes.length > 0 && <span className="normal-case tracking-normal font-semibold">· {m.count_playbook({ count: routes.length })}</span>}
        </h3>
        {routes.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {m.ppv_empty()}
            {canEdit && <> <Link to={`/personas/${persona.id}/edit`} className="font-medium text-accent hover:underline">{m.ppv_add_one()}</Link></>}
          </p>
        ) : (
          <ol className="space-y-2">
            {routes.map(r => {
              const title = r.templateTitle || m.pb_untitled();
              return (
                <li key={r.templateId} className="flex items-start gap-2.5 text-sm">
                  <span aria-hidden className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${r.templateKind === 'skill' ? 'bg-skill' : 'bg-accent'}`} />
                  <span className="min-w-0">
                    {visiblePlaybookIds.has(r.templateId)
                      ? <Link to={`/playbooks?id=${encodeURIComponent(r.templateId)}`} className="font-semibold text-ink-strong hover:underline">{title}</Link>
                      : <span className="font-semibold text-ink-strong">{title}</span>}
                    {/* "If" — the editor's word for the condition since SQEM-550 (d), so both screens read alike. */}
                    {r.condition && <span className="block text-ink-muted"><span className="text-2xs font-bold uppercase tracking-wider text-ink-subtle mr-1">{m.ppv_if()}</span>{r.condition}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* SQEM-620 — the same "Info" box as the playbook preview, here with the owner only. */}
      <section aria-labelledby="persona-preview-info" className="mt-3 rounded-card bg-surface-sunken p-4">
        <h3 id="persona-preview-info" className="text-2xs font-bold uppercase tracking-wider text-ink-subtle mb-1.5">{m.pv_info()}</h3>
        <dl className="text-sm text-ink grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-ink-subtle">{m.ed_owner()}</dt>
            <dd className="mt-0.5"><OwnerLine createdBy={persona.createdBy} members={members} /></dd>
          </div>
          {/* SQEM-643 — the services the role works with, and whether THIS viewer has connected each. */}
          {services.length > 0 && (
            <div>
              <dt className="text-xs font-semibold text-ink-subtle" title={m.ppv_connectors_title_hint()}>{m.pe_connectors_title()}</dt>
              <dd className="mt-1 space-y-1.5">
                {services.map(s => (
                  <div key={s.key} className="flex items-center gap-2 min-w-0">
                    <ServiceLogo serviceKey={s.key} />
                    <span className="truncate">{s.name}</span>
                    {missingKeys.has(s.key) && (
                      <span className="shrink-0 text-2xs text-ink-subtle">
                        {m.pe_connector_not_connected()} ·{' '}
                        <Link to="/settings" state={{ initialTab: 'connectors' }} className="font-semibold text-accent hover:underline">
                          {m.pe_connector_connect()}
                        </Link>
                      </span>
                    )}
                  </div>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {canEdit && (
        <div className="mt-4 pt-4 border-t border-line flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => onDuplicate(persona)} className={ACTION}><Copy className="w-4 h-4" /> {m.pv_duplicate()}</button>
          <button type="button" onClick={() => onExport(persona)} className={ACTION} title={m.ppv_download_title()}><FolderDown className="w-4 h-4" /> {m.pv_download()}</button>
          {/* SQEM-539 — set apart from the everyday actions, so it is not the one hit by accident. */}
          <span className="ml-auto pl-2 border-l border-line">
            <button type="button" onClick={() => onDelete(persona)} className={`${ACTION} hover:text-danger`}><Trash2 className="w-4 h-4" /> {m.pv_delete()}</button>
          </span>
        </div>
      )}
    </article>
  );
}
