// SQEM-324 — the Persona archive.
//
// ⚠️ **No global store context, deliberately.** Every other list page reads from `store/`, which is
// right for data several screens share — templates appear on the Dashboard, in Chat and in the
// editor. A persona appears on exactly two screens, both of which are this feature. Wiring it into
// `AppProvider.loadWorkspaceData` would put it in the critical path of every workspace load to serve
// two routes, and that load is the one thing in the app nobody wants to make slower or riskier.
// If personas ever reach the Dashboard, this is the moment to reconsider — not before.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Users, Loader2, Route as RouteIcon, Edit, Copy, FolderDown, Trash2, Sparkles, Lock, Upload, Star } from 'lucide-react';
import { useWorkspace, useUI, usePrompts, useData } from '../store';
import { can } from '../lib/permissions';
import { fetchPersonas, duplicatePersona, deletePersona, setPersonaFavorite, updatePersona } from '../lib/api/personas';
import { collectWorkspaceTags } from '../lib/workspaceTags';
import TagFilter from '../components/ui/TagFilter';
import TagEditor from '../components/ui/TagEditor';
import { fetchRestrictedPersonaIds } from '../lib/api/personaAccess';
import { buildBundle, downloadBlob, readBundle, importBundle } from '../lib/templateBundle';
import type { BundleManifest } from '../lib/bundleFormat';
import type { Persona } from '../types';
import TemplateCard from '../components/ui/TemplateCard';
import EmptyState from '../components/ui/EmptyState';
import SearchInput from '../components/ui/SearchInput';
import PageHeader from '../components/ui/PageHeader';
import Checkbox from '../components/ui/Checkbox';
import BulkActionBar from '../components/ui/BulkActionBar';
import ConfirmModal from '../components/ui/ConfirmModal';
import PersonaWizardModal from '../components/PersonaWizardModal';
import { IS_SELF_HOSTED } from '../lib/env';

const toSlug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'persona';

/** The routes of a persona, as chips. */
function RouteChips({ persona }: { persona: Persona }) {
  // Three, then a count. ⚠️ The count alone was the other candidate and is worse: "7 templates"
  // tells you a persona is big, the chips tell you what it *does*, which is the question somebody
  // scanning an archive is actually asking.
  const shown = persona.routes.slice(0, 3);
  const rest = persona.routes.length - shown.length;

  if (persona.routes.length === 0) {
    return (
      <span className="text-2xs text-slate-400 dark:text-slate-500 italic">
        No routes yet — this persona loads nothing
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap min-w-0">
      {shown.map(r => (
        <span
          key={r.templateId}
          className="text-2xs font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 max-w-[10rem] truncate"
          title={r.condition || r.templateTitle}
        >
          {r.templateTitle || 'Untitled'}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-2xs font-semibold px-2 py-1 rounded-lg text-slate-400 dark:text-slate-500">
          +{rest}
        </span>
      )}
    </div>
  );
}

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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [restrictedIds, setRestrictedIds] = useState<Set<string>>(new Set());
  const [importData, setImportData] = useState<{ zip: any; manifest: BundleManifest } | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

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
          : 'Downloaded — this persona has no routes, so no playbooks travelled with it',
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
      showToast(err?.message || 'Not a Sqemes bundle', 'error');
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
      showToast(err?.message || 'Import failed', 'error');
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
              title="Import a .sqemes.zip bundle — personas arrive with the playbooks they route to"
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
        />
      )}

      {personas === null && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-20 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading personas…
        </div>
      )}

      {/* ⚠️ The empty state carries the explanation, because a persona is a new idea and this is the
          only screen that can teach it. SQEM-287 made the same argument for templates: the first
          screen a new user sees is the worst possible place to assume the word is self-evident. */}
      {personas !== null && personas.length === 0 && (
        <EmptyState
          icon={<Users className="w-8 h-8 text-brand-400" />}
          iconWrapClassName="bg-brand-50 dark:bg-brand-900/20"
          title="No personas yet"
          description="A persona bundles the playbooks one role needs, with a condition for each."
          extra={
            <div className="max-w-md mx-auto mt-4 text-left text-sm text-slate-500 dark:text-slate-400 space-y-2">
              <p>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Example — “Sales”:</span>{' '}
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
          icon={showFavoritesOnly ? <Star className="w-8 h-8 text-amber-300" /> : <Users className="w-8 h-8 text-slate-400" />}
          title={showFavoritesOnly ? 'No favourite personas' : 'Nothing matches'}
          description={showFavoritesOnly ? 'Star personas to see them here.' : 'No persona matches your search or filters.'}
        />
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map(persona => (
            <TemplateCard
              key={persona.id}
              selected={selectedIds.has(persona.id)}
              topLeft={canEdit && (
                /* SQEM-168's padding trick: the label gives the 16px checkbox a hit margin over the
                   stretched card link, which would otherwise swallow the click. */
                <label
                  aria-label={`Select ${persona.title}`}
                  onClick={e => e.stopPropagation()}
                  className="absolute top-1 left-1 z-20 p-1.5 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(persona.id)}
                    onChange={() => toggleSelect(persona.id)}
                    align="center"
                    className={`bg-white dark:bg-slate-800 shadow transition-opacity ${selectedIds.has(persona.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                  />
                </label>
              )}
              topRight={(
                /* SQEM-393 — the star, exactly where the playbook card has it. */
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); void toggleFavorite(persona); }}
                  className="absolute top-1.5 right-1.5 z-20 p-3 text-slate-300 hover:text-amber-400 hover:scale-110 transition-all focus:outline-none"
                  title={persona.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star className={`w-5 h-5 ${persona.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                </button>
              )}
              /* SQEM-393 — the tag above the title: chip + "+ tag" while there is none and the person may edit. */
              badges={(
                <TagEditor
                  tags={persona.tags.slice(0, 1)}
                  available={canEdit && persona.tags.length === 0 ? workspace.tags : []}
                  canEdit={canEdit}
                  onAdd={tag => void setTag(persona, tag)}
                  onRemove={() => void setTag(persona, null)}
                />
              )}
              title={persona.title}
              /* SQEM-389 — the title opens the persona in Chat, like a playbook card; edit is the pencil. */
              titleHref={`/personas/${persona.id}`}
              description={persona.description}
              /* Title → description → what it routes to → what you can do with it. The chips answer
                 "what does this persona actually do", which continues the description rather than
                 classifying the card or acting on it. */
              extra={<RouteChips persona={persona} />}
              footerLeft={canEdit ? (
                <>
                  <Link to={`/personas/${persona.id}/edit`} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors" title="Edit">
                    <Edit className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={e => { e.preventDefault(); void handleDuplicate(persona); }}
                    className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    title="Duplicate"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.preventDefault(); void handleExport([persona]); }}
                    className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    title="Download persona with its playbooks (.sqemes.zip)"
                  >
                    <FolderDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.preventDefault(); setPendingDelete([persona]); }}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : undefined}
              footerRight={
                <span className="flex items-center gap-2 shrink-0">
                  {/* SQEM-330 — the same badge as a restricted template card, in the same words. A
                      second vocabulary for one state is how two screens begin disagreeing about what
                      "restricted" means. */}
                  {restrictedIds.has(persona.id) && (
                    <span
                      className="text-2xs font-bold px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-lg uppercase tracking-wider flex items-center gap-1"
                      title="Restricted — not visible to everyone in this workspace"
                    >
                      <Lock className="w-3 h-3" /> Restricted
                    </span>
                  )}
                  <span className="text-2xs text-slate-400 dark:text-slate-500 flex items-center gap-1" title={`${persona.routes.length} route${persona.routes.length === 1 ? '' : 's'}`}>
                    <RouteIcon className="w-3 h-3" />
                    {persona.routes.length}
                  </span>
                </span>
              }
            />
          ))}
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
          showToast('Persona generated — review the routes before using it', 'success');
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
          <span className="font-semibold text-slate-600 dark:text-slate-300">
            {(importData?.manifest.personas || []).length} persona{(importData?.manifest.personas || []).length === 1 ? '' : 's'}
          </span>{' '}
          and{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-300">
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
          {pendingDelete && pendingDelete.length > 1 ? 'The personas and their routes are' : 'The persona and its routes are'} removed.{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-300">The playbooks themselves are not touched</span> — they keep working on their own.
        </p>
      </ConfirmModal>
    </div>
  );
}
