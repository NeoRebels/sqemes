// SQEM-324 — the Persona archive.
//
// ⚠️ **No global store context, deliberately.** Every other list page reads from `store/`, which is
// right for data several screens share — templates appear on the Dashboard, in Chat and in the
// editor. A persona appears on exactly two screens, both of which are this feature. Wiring it into
// `AppProvider.loadWorkspaceData` would put it in the critical path of every workspace load to serve
// two routes, and that load is the one thing in the app nobody wants to make slower or riskier.
// If personas ever reach the Dashboard, this is the moment to reconsider — not before.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Loader2, Sparkles, Upload, Star, Bot } from 'lucide-react';
import { useWorkspace, useUI, usePrompts, useData } from '../store';
import { can } from '../lib/permissions';
import { fetchPersonas, duplicatePersona, deletePersona, setPersonaFavorite, updatePersona } from '../lib/api/personas';
import { collectWorkspaceTags } from '../lib/workspaceTags';
import TagFilter from '../components/ui/TagFilter';
import { fetchRestrictedPersonaIds } from '../lib/api/personaAccess';
import { fetchCanEditMany } from '../lib/api/editors';
import { applyToEditable, bulkSummary } from '../lib/bulkApply';
import AccessBadge from '../components/ui/AccessBadge';
import type { AccessBadgeMode } from '../lib/accessBadge';
import { buildBundle, downloadBlob, readBundle, importBundle } from '../lib/templateBundle';
import type { BundleManifest } from '../lib/bundleFormat';
import type { Persona } from '../types';
import PersonaPreview from '../components/PersonaPreview';
import EmptyState from '../components/ui/EmptyState';
import SearchInput from '../components/ui/SearchInput';
import PageHeader from '../components/ui/PageHeader';
import Checkbox from '../components/ui/Checkbox';
import BulkActionBar from '../components/ui/BulkActionBar';
import ConfirmModal from '../components/ui/ConfirmModal';
import PersonaWizardModal from '../components/PersonaWizardModal';
import { IS_SELF_HOSTED } from '../lib/env';
import { errorMessage } from '../lib/errorMessage';

const toSlug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'persona';

/**
 * SQEM-554 (b) — one row of the list (redesign C, the same row as the Playbooks page, SQEM-550 b):
 * title, "N playbooks · tag", access, favourite. The title is the row's button and its `::after`
 * covers the row (the SQEM-538 row pattern); checkbox and star sit above it with `relative z-10`.
 * Every action that used to be on the card is in the preview (`components/PersonaPreview.tsx`).
 */
const PersonaRow = memo(function PersonaRow({
  persona,
  canEdit,
  accessMode,
  active,
  selected,
  onSelect,
  onToggleSelect,
  onFavorite,
}: {
  persona: Persona;
  canEdit: boolean;
  accessMode?: AccessBadgeMode;
  active: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onFavorite: (persona: Persona) => void;
}) {
  const n = persona.routes.length;
  return (
    <li className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-control transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-surface-sunken'}`}>
      {canEdit && (
        // SQEM-168 — padded label gives the 16px checkbox a hit margin over the stretched row button.
        <label aria-label={`Select ${persona.title}`} className="relative z-10 p-1 -m-1 cursor-pointer">
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(persona.id)}
            align="center"
            className={selected ? 'opacity-100' : 'reveal-on-hover'}
          />
        </label>
      )}
      <Bot aria-hidden className="w-4 h-4 text-accent shrink-0" />
      <button
        type="button"
        onClick={() => onSelect(persona.id)}
        aria-current={active ? 'true' : undefined}
        className="flex-1 min-w-0 text-left after:absolute after:inset-0 after:rounded-control focus:outline-none"
      >
        <span className="block text-sm font-semibold text-ink-strong truncate">{persona.title}</span>
        <span className={`block text-xs truncate ${n === 0 ? 'text-ink-subtle italic' : 'text-ink-muted'}`}>
          {n === 0 ? 'Loads nothing yet' : `${n} playbook${n === 1 ? '' : 's'}`}{persona.tags[0] ? ` · ${persona.tags[0]}` : ''}
        </span>
      </button>
      {accessMode && <span className="relative z-10"><AccessBadge mode={accessMode} /></span>}
      <button
        type="button"
        onClick={() => onFavorite(persona)}
        aria-pressed={!!persona.isFavorite}
        aria-label={persona.isFavorite ? `Remove ${persona.title} from favourites` : `Add ${persona.title} to favourites`}
        className="hit-24 relative z-10 p-1 text-ink-subtle hover:text-amber-400 transition-colors"
      >
        <Star className={`w-4 h-4 ${persona.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
      </button>
    </li>
  );
});

export default function Personas() {
  const { workspace, currentUser } = useWorkspace();
  const { showToast } = useUI();
  const { prompts } = usePrompts();
  const { workspaceFiles } = useData();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [search, setSearch] = useState('');
  // SQEM-393 — the two filters the Playbooks archive has had since SQEM-071/087.
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Persona[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tagBusy, setTagBusy] = useState(false); // SQEM-564 — bulk tag
  const [wizardOpen, setWizardOpen] = useState(false);
  const [restrictedIds, setRestrictedIds] = useState<Map<string, AccessBadgeMode>>(new Map()); // SQEM-400 — the word per persona
  const [importData, setImportData] = useState<{ zip: any; manifest: BundleManifest } | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  // SQEM-554 (b) — the selected persona lives in the URL (`?id=`), as on the Playbooks page: a link
  // to one persona works, and Back returns to the list on a phone.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedParam = searchParams.get('id');
  const selectPersona = useCallback((id: string) => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('id', id); return next; });
  }, [setSearchParams]);
  const backToList = () => setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('id'); return next; });
  const visiblePlaybookIds = useMemo(() => new Set(prompts.map(p => p.id)), [prompts]);

  const canEdit = can(currentUser, workspace, 'prompts:edit');

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchPersonas(workspace.id, currentUser.id); // SQEM-393 — with the stars
        if (!cancelled) setPersonas(rows);
        // SQEM-330 — for the Restricted badge. ⚠️ Failure is silent on purpose: the badge is
        // information, and a toast about a missing badge while somebody browses personas is noise
        // about the wrong thing. On self-host there are no rules to find, so it comes back empty.
        try {
          const ids = await fetchRestrictedPersonaIds(workspace.id);
          if (!cancelled) setRestrictedIds(ids);
        } catch { /* the badge simply does not appear */ }
      } catch (err: any) {
        if (!cancelled) {
          setPersonas([]);
          showToast(err?.message || 'Could not load personas', 'error');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  // SQEM-393 — the tag vocabulary: playbooks + files + personas (see `collectWorkspaceTags`).
  const allTags = useMemo(
    () => collectWorkspaceTags(prompts, workspaceFiles, personas ?? []),
    [prompts, workspaceFiles, personas],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (personas ?? []).filter(p => {
      if (showFavoritesOnly && !p.isFavorite) return false;
      if (selectedTag && !p.tags.includes(selectedTag)) return false;
      if (!q) return true;
      return p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.routes.some(r => (r.templateTitle || '').toLowerCase().includes(q));
    });
  }, [personas, search, showFavoritesOnly, selectedTag]);

  // SQEM-393 — optimistic, then the row; on failure the state goes back and the toast says so.
  // The same shape as `toggleFavorite` in `store/prompts.tsx`, kept here because personas are not
  // in the store (see the header).
  const toggleFavorite = async (persona: Persona) => {
    const next = !persona.isFavorite;
    setPersonas(prev => (prev ?? []).map(p => p.id === persona.id ? { ...p, isFavorite: next } : p));
    try {
      await setPersonaFavorite(persona.id, currentUser.id, next);
      showToast(next ? 'Added to favorites' : 'Removed from favorites', 'success');
    } catch (err: any) {
      setPersonas(prev => (prev ?? []).map(p => p.id === persona.id ? { ...p, isFavorite: persona.isFavorite } : p));
      showToast(err?.message || 'Failed to update favourite', 'error');
    }
  };

  // One tag per persona in the UI; the column stays an array (SQEM-324) so nothing below changes.
  const setTag = async (persona: Persona, tag: string | null) => {
    const tags = tag ? [tag] : [];
    setPersonas(prev => (prev ?? []).map(p => p.id === persona.id ? { ...p, tags } : p));
    try {
      await updatePersona(persona.id, { tags });
    } catch (err: any) {
      setPersonas(prev => (prev ?? []).map(p => p.id === persona.id ? { ...p, tags: persona.tags } : p));
      showToast(err?.message || 'Failed to update tag', 'error');
    }
  };

  // SQEM-564 — one tag for several personas at once (one tag per persona in the UI, as `setTag` above).
  // Checks the edit right per persona first; one summary instead of a toast per item.
  const bulkSetTag = async (tag: string | null, ids: string[]) => {
    setTagBusy(true);
    try {
      const tags = tag ? [tag] : [];
      const outcome = await applyToEditable(ids, list => fetchCanEditMany('persona', list), id => updatePersona(id, { tags }));
      if (outcome.changed.length) {
        const changed = new Set(outcome.changed);
        setPersonas(prev => (prev ?? []).map(p => changed.has(p.id) ? { ...p, tags } : p));
      }
      const { message, type } = bulkSummary(outcome, 'persona', tag ? `Tag “${tag}” set` : 'Tag removed');
      showToast(message, type);
    } finally {
      setTagBusy(false);
    }
  };

  const selectedPersona = visible.find(p => p.id === selectedParam) ?? visible[0] ?? null;
  const showPreviewOnMobile = !!selectedParam && selectedPersona?.id === selectedParam;

  const visibleIds = visible.map(p => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelectedIds(prev => {
    const next = new Set(prev);
    if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
    else visibleIds.forEach(id => next.add(id));
    return next;
  });

  const handleDuplicate = async (persona: Persona) => {
    try {
      const copy = await duplicatePersona(persona, currentUser.id || null);
      setPersonas(prev => [copy, ...(prev ?? [])]);
      showToast('Persona duplicated', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not duplicate the persona', 'error');
    }
  };

  /**
   * Export personas as a `.sqemes.zip`.
   *
   * ⛔ **The attached templates travel with them.** A persona is a set of references; on its own it
   * imports as a role description whose every route leads nowhere. So the bundle is built from the
   * union of the selected personas' templates — with their context files, which `buildBundle`
   * fetches — and the routes address them by bundle ref.
   *
   * ⚠️ A route whose template is no longer in the workspace is silently absent from that union, and
   * `buildBundle` drops it rather than writing a ref to nothing.
   */
  const handleExport = async (toExport: Persona[]) => {
    if (toExport.length === 0) return;
    setExporting(true);
    try {
      const ids = new Set(toExport.flatMap(p => p.routes.map(r => r.templateId)));
      const templates = prompts.filter(t => ids.has(t.id));
      const { blob } = await buildBundle(templates, workspaceFiles, toExport);
      const name = toExport.length === 1 ? `${toSlug(toExport[0].title)}.sqemes.zip` : `personas-${toExport.length}.sqemes.zip`;
      downloadBlob(blob, name);
      showToast(
        templates.length
          ? `Downloaded ${toExport.length} persona${toExport.length === 1 ? '' : 's'} with ${templates.length} playbook${templates.length === 1 ? '' : 's'}`
          : 'Downloaded — this persona uses no playbooks, so none travelled with it',
        'success',
      );
    } catch (err: any) {
      showToast(err?.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  /**
   * SQEM-330 — import, on the page that offers export.
   *
   * ⚠️ **The capability already existed** — `importBundle` has created personas since the export
   * shipped, and the Templates page can read the same file. What was missing is that somebody who
   * exported a persona *here* went looking for import *here*. An export button whose counterpart
   * lives on another page is a one-way door in the interface, not a missing feature underneath it.
   *
   * ⛔ It reuses the same reader and the same writer. A second import path would be a second place
   * for the format to be interpreted, and the two would answer differently about the same file
   * eventually — the failure this repo keeps recording about paired functions.
   */
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be picked again after a cancel
    if (!file) return;
    try {
      setImportData(await readBundle(file));
    } catch (err: any) {
      showToast(err?.message || 'Not a sqemes bundle', 'error');
    }
  };

  const confirmImport = async () => {
    if (!importData || !workspace?.id) return;
    setImporting(true);
    try {
      const { personas: created, templates } = await importBundle(importData.zip, importData.manifest, workspace.id, currentUser.id);
      setImportData(null);
      // Re-read rather than patch state: the import created templates too, and the routes point at
      // ids only the server knows. Guessing them here would be a second, worse implementation of
      // what the query already answers.
      setPersonas(await fetchPersonas(workspace.id, currentUser.id));
      showToast(
        `Imported ${created} persona${created === 1 ? '' : 's'}` + (templates ? ` and ${templates} playbook${templates === 1 ? '' : 's'}` : ''),
        'success',
      );
    } catch (err: any) {
      showToast(errorMessage(err, 'Import failed'), 'error');
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = async () => {
    const targets = pendingDelete ?? [];
    setDeleting(true);
    try {
      const results = await Promise.allSettled(targets.map(p => deletePersona(p.id)));
      const okIds = new Set(targets.filter((_, i) => results[i].status === 'fulfilled').map(p => p.id));
      setPersonas(prev => (prev ?? []).filter(p => !okIds.has(p.id)));
      setSelectedIds(prev => { const next = new Set(prev); okIds.forEach(id => next.delete(id)); return next; });
      const failed = targets.length - okIds.size;
      if (failed === 0) showToast(`Deleted ${okIds.size} persona${okIds.size === 1 ? '' : 's'}`, 'success');
      else showToast(`Deleted ${okIds.size} of ${targets.length} — ${failed} failed`, 'error');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  // SQEM-388 — one definition, two places (header and empty state), like the Templates page's
  // `wizardButton`. No brand gate here, unlike the Template Wizard: a persona describes how a role
  // works, not how the brand sounds (SQEM-325).
  const wizardButton = !IS_SELF_HOSTED && canEdit ? (
    <button
      onClick={() => setWizardOpen(true)}
      className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 px-5 py-2.5 rounded-xl font-medium text-sm transition-all justify-center"
    >
      <Sparkles className="w-4 h-4" /> Persona Wizard
    </button>
  ) : null;

  return (
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto">
      {/* SQEM-384 — two of three UX testers read "Persona" as a person on the team. The second
          sentence answers that, and names where a persona works: Chat (since SQEM-373) and MCP.
          ⛔ NOT the extension — it inserts templates into ChatGPT & Co. and knows nothing of
          personas. The first cut said "the extension" here; the owner caught it on staging. */}
      <PageHeader
        title="Personas"
        subtitle="A working role that knows which of your playbooks to reach for, and when — an AI role, not a team member. Works in Chat and via MCP."
        actions={canEdit && (
          <>
            {/* SQEM-325 — Cloud-only, like the Template Wizard. ⚠️ Not for want of model access:
                `runAuthoringAI` works on self-host over BYOK, and the enhance buttons in the editor
                use it there. The wizard is Cloud's guided surface, which is a product decision
                (SQEM-170) — said here so nobody later "fixes" it as an oversight.
                ⚠️ Also no brand-profile gate, unlike the Template Wizard: that one writes in the
                brand's voice, a persona describes how a role works. */}
            <input ref={importInputRef} type="file" accept=".zip,.sqemes" onChange={handleImportFile} className="hidden" />
            <button
              onClick={() => importInputRef.current?.click()}
              title="Import a .sqemes.zip bundle — personas arrive with the playbooks they use"
              className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 rounded-xl font-medium text-sm transition-all justify-center"
            >
              <Upload className="w-4 h-4" /> Import
            </button>
            {wizardButton}
            <Link
              to="/personas/new"
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg shadow-brand-200 hover:shadow-brand-300 dark:shadow-none flex-1 sm:flex-none justify-center"
            >
              <Plus className="w-5 h-5" /> New Persona
            </Link>
          </>
        )}
      />

      {(personas?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 mb-8 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search personas..." />
          {/* SQEM-393 — the same toggle and the same filter as the Playbooks archive. */}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-1.5 self-stretch px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${showFavoritesOnly ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
          >
            <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
            Favorites
          </button>
          {allTags.length > 0 && (
            <TagFilter tags={allTags} value={selectedTag} onChange={setSelectedTag} />
          )}
        </div>
      )}

      {/* SQEM-330 — the same bulk bar as Templates and Files. Export sits beside Delete because
          those are the two reasons somebody selects several at once. */}
      {canEdit && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          total={visibleIds.length}
          allSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          onDelete={() => setPendingDelete((personas ?? []).filter(p => selectedIds.has(p.id)))}
          onClear={() => setSelectedIds(new Set())}
          noun="persona"
          onExport={() => void handleExport((personas ?? []).filter(p => selectedIds.has(p.id)))}
          exporting={exporting}
          addableTags={allTags}
          removableTags={[...new Set((personas ?? []).filter(p => selectedIds.has(p.id)).map(p => p.tags[0]).filter((t): t is string => !!t))].sort()}
          addTagLabel="Set tag"
          onAddTag={tag => void bulkSetTag(tag, [...selectedIds])}
          onRemoveTag={tag => void bulkSetTag(null, (personas ?? []).filter(p => selectedIds.has(p.id) && p.tags[0] === tag).map(p => p.id))}
          tagBusy={tagBusy}
        />
      )}

      {personas === null && (
        <div className="flex items-center gap-2 text-ink-subtle text-sm py-20 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading personas…
        </div>
      )}

      {/* ⚠️ The empty state carries the explanation, because a persona is a new idea and this is the
          only screen that can teach it. SQEM-287 made the same argument for templates: the first
          screen a new user sees is the worst possible place to assume the word is self-evident. */}
      {personas !== null && personas.length === 0 && (
        <EmptyState
          icon={<Bot className="w-8 h-8" />}
          tone="brand"
          title="No personas yet"
          description="A persona bundles the playbooks one role needs, with a condition for each."
          extra={
            <div className="max-w-md mx-auto mt-4 text-left text-sm text-ink-muted space-y-2">
              <p>
                <span className="font-semibold text-ink">Example — “Sales”:</span>{' '}
                the offer-layout skill when a quote is being written, the workshop playbook when a
                workshop is offered, the use-case generator when somebody asks what AI could do for them.
              </p>
              <p>
                Chat or your MCP client loads the persona, then fetches a playbook only once its
                condition applies — so the knowledge arrives when it is needed instead of all at once.
              </p>
            </div>
          }
          action={canEdit ? (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/personas/new" className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all">
                <Plus className="w-4 h-4" /> Create your first persona
              </Link>
              {wizardButton}
            </div>
          ) : undefined}
        />
      )}

      {personas !== null && personas.length > 0 && visible.length === 0 && (
        <EmptyState
          icon={showFavoritesOnly ? <Star className="w-8 h-8 text-amber-300" /> : <Bot className="w-8 h-8" />}
          title={showFavoritesOnly ? 'No favourite personas' : 'Nothing matches'}
          description={showFavoritesOnly ? 'Star personas to see them here.' : 'No persona matches your search or filters.'}
        />
      )}

      {/* SQEM-554 (b) — redesign C: the list on the left, the selected persona on the right, as on the
          Playbooks page. Below `lg` one at a time: the list, or (with ?id=) the preview with a way back. */}
      {visible.length > 0 && (
        <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-6 lg:items-start">
          <ul aria-label="Personas" className={`rounded-card border border-line bg-surface-raised p-2 space-y-0.5 ${showPreviewOnMobile ? 'hidden lg:block' : ''}`}>
            {visible.map(persona => (
              <PersonaRow
                key={persona.id}
                persona={persona}
                canEdit={canEdit}
                accessMode={restrictedIds.get(persona.id)}
                active={selectedPersona?.id === persona.id}
                selected={selectedIds.has(persona.id)}
                onSelect={selectPersona}
                onToggleSelect={toggleSelect}
                onFavorite={p => void toggleFavorite(p)}
              />
            ))}
          </ul>
          {selectedPersona && (
            <div className={`lg:sticky lg:top-4 ${showPreviewOnMobile ? '' : 'hidden lg:block'}`}>
              <PersonaPreview
                persona={selectedPersona}
                canEdit={canEdit}
                accessMode={restrictedIds.get(selectedPersona.id)}
                workspaceTags={workspace.tags}
                visiblePlaybookIds={visiblePlaybookIds}
                onDuplicate={p => void handleDuplicate(p)}
                onExport={p => void handleExport([p])}
                onDelete={p => setPendingDelete([p])}
                onSetTag={(p, tag) => void setTag(p, tag)}
                onFavorite={p => void toggleFavorite(p)}
                onBack={backToList}
              />
            </div>
          )}
        </div>
      )}

      {/* Straight into the editor afterwards: the wizard's output is a draft somebody should read,
          and the editor is where the routes and their conditions are visible side by side. Dropping
          them back on the archive would hide exactly the part worth checking. */}
      <PersonaWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={persona => {
          setWizardOpen(false);
          setPersonas(prev => [persona, ...(prev ?? [])]);
          showToast('Persona generated — review its playbooks before using it', 'success');
          navigate(`/personas/${persona.id}/edit`);
        }}
      />

      {/* ⚠️ The count of TEMPLATES is stated as prominently as the personas. Importing a persona
          creates the templates it routes to — that is the whole reason the export carries them —
          and somebody who expected one object and got nine should have read it here, not found out
          afterwards on the Templates page. */}
      <ConfirmModal
        open={!!importData}
        title="Import this bundle?"
        confirmLabel={importing ? 'Importing…' : 'Import'}
        variant="primary"
        busy={importing}
        onConfirm={() => void confirmImport()}
        onClose={() => setImportData(null)}
      >
        <p>
          Adds{' '}
          <span className="font-semibold text-ink">
            {(importData?.manifest.personas || []).length} persona{(importData?.manifest.personas || []).length === 1 ? '' : 's'}
          </span>{' '}
          and{' '}
          <span className="font-semibold text-ink">
            {(importData?.manifest.templates || []).length} playbook{(importData?.manifest.templates || []).length === 1 ? '' : 's'}
          </span>
          {(importData?.manifest.files || []).length ? ` plus ${(importData?.manifest.files || []).length} context file${(importData?.manifest.files || []).length === 1 ? '' : 's'}` : ''} to {workspace?.name}.
        </p>
        <p>
          The playbooks are created as copies — a persona&apos;s routes must point at something, so they
          travel with it. Access rules do not: an imported persona starts under this workspace&apos;s own rule.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={!!pendingDelete}
        title={pendingDelete && pendingDelete.length > 1 ? `Delete ${pendingDelete.length} personas?` : 'Delete this persona?'}
        confirmLabel={pendingDelete && pendingDelete.length > 1 ? 'Delete personas' : 'Delete persona'}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      >
        <p>
          {pendingDelete && pendingDelete.length > 1 ? 'The personas are removed, with the lists of playbooks they use.' : 'The persona is removed, with the list of playbooks it uses.'}{' '}
          <span className="font-semibold text-ink">The playbooks themselves are not touched</span> — they keep working on their own.
        </p>
      </ConfirmModal>
    </div>
  );
}
