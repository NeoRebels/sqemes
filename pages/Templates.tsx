import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { useUI, useWorkspace, usePrompts, useData } from '../store';
import { collectWorkspaceTags } from '../lib/workspaceTags';
import { can } from '../lib/permissions';
import { IS_SELF_HOSTED } from '../lib/env';
import { m } from '../lib/i18n';
import { fetchRestrictedTemplateIds, setTemplateAccess } from '../lib/api/templateAccess';
import { fetchCanEditMany } from '../lib/api/editors';
import { fetchGroups } from '../lib/api/groups';
import { applyToEditable, bulkSummary, wouldLoseSight } from '../lib/bulkApply';
import { isMultiSeat } from '../lib/templateAccessScope';
import { TemplateAccessControl, accessValueToAccess, type TemplateAccessValue } from '../components/TemplateAccessControl';
import AccessBadge from '../components/ui/AccessBadge';
import type { AccessBadgeMode } from '../lib/accessBadge';
import { exportTemplatesToZip, downloadBlob, readBundle, importBundle, type BundleManifest } from '../lib/templateBundle';
import { importErrorMessage, readSkillZip, toSlug, type SkillBundle } from '../lib/skillBundle';
import { importSkillBundle } from '../lib/skillBundleIo';
import { publishToMarketplace, submitToMarketplaceViaProxy, fetchCanPublish } from '../lib/api/library';
import { TEMPLATE_CATEGORIES } from '../constants';
import { categoryLabel, kindHelp } from '../lib/labels';
import type JSZip from 'jszip';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Search, Plus, Trash2, Star, PenTool, Wand2, Sparkles, Loader2, Store, Upload, Package, FolderDown } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import BulkActionBar from '../components/ui/BulkActionBar';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import EmptyState from '../components/ui/EmptyState';
import TagFilter from '../components/ui/TagFilter';
import { Prompt, PromptKind, TemplateCategory } from '../types';
import Checkbox from '../components/ui/Checkbox';
import TemplateWizardModal from '../components/TemplateWizardModal';
import PlaybookPreview, { type LoadedBy } from '../components/PlaybookPreview';
import { fetchPersonas } from '../lib/api/personas';
import { brandIsComplete } from '../lib/brand';
import { errorMessage } from '../lib/errorMessage';
import Select from '../components/ui/Select';

const PromptSkeleton = () => (
  <div className="animate-pulse flex items-center gap-3 px-3 py-3">
    <div className="w-2.5 h-2.5 rounded-full bg-surface-sunken" />
    <div className="flex-1 space-y-1.5">
      <div className="h-4 w-2/3 bg-surface-sunken rounded-chip" />
      <div className="h-3 w-1/3 bg-surface-sunken rounded-chip" />
    </div>
  </div>
);

/**
 * SQEM-550 (b) — one row of the list (redesign C): kind dot, title, kind · tag, access, favourite.
 * The title is the row's button and its `::after` covers the row (the SQEM-538 row pattern); the
 * checkbox and the star sit above it with `relative z-10`. Every action that used to be on the card
 * is in the preview now (`components/PlaybookPreview.tsx`).
 */
const PlaybookRow = memo(function PlaybookRow({
  prompt,
  canEdit,
  accessMode,
  active,
  selected,
  onSelect,
  onToggleSelect,
  onFavorite,
}: {
  prompt: Prompt;
  canEdit: boolean;
  accessMode?: AccessBadgeMode; // SQEM-400 — undefined = open to everyone (no badge)
  active: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onFavorite: (prompt: Prompt) => void;
}) {
  return (
    <li className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-control transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-surface-sunken'}`}>
      {canEdit && (
        // SQEM-168 — padded label gives the 16px checkbox a hit margin over the stretched row button.
        <label aria-label={m.pb_select({ title: prompt.title })} className="relative z-10 p-1 -m-1 cursor-pointer">
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(prompt.id)}
            align="center"
            className={selected ? 'opacity-100' : 'reveal-on-hover'}
          />
        </label>
      )}
      <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${prompt.kind === 'prompt' ? 'bg-accent' : 'bg-skill'}`} />
      <button
        type="button"
        onClick={() => onSelect(prompt.id)}
        aria-current={active ? 'true' : undefined}
        title={kindHelp(prompt.kind)}
        className="flex-1 min-w-0 text-left after:absolute after:inset-0 after:rounded-control focus:outline-none"
      >
        <span className="block text-sm font-semibold text-ink-strong truncate">{prompt.title}</span>
        <span className="block text-xs text-ink-muted truncate capitalize">{prompt.kind}{prompt.tag ? ` · ${prompt.tag}` : ''}</span>
      </button>
      {accessMode && <span className="relative z-10"><AccessBadge mode={accessMode} /></span>}
      <button
        type="button"
        onClick={() => onFavorite(prompt)}
        aria-pressed={!!prompt.isFavorite}
        aria-label={prompt.isFavorite ? m.pb_unfavourite({ title: prompt.title }) : m.pb_favourite({ title: prompt.title })}
        className="hit-24 relative z-10 p-1 text-ink-subtle hover:text-amber-400 transition-colors"
      >
        <Star className={`w-4 h-4 ${prompt.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
      </button>
    </li>
  );
});

const Templates = () => {
  const { prompts, deletePrompt, deletePrompts, duplicatePrompt, toggleFavorite: storeFavorite, updatePrompt, setTagMany } = usePrompts();
  const { workspaceFiles, addWorkspaceFile } = useData();
  const { currentUser, workspace } = useWorkspace();
  const { showToast, isLoading } = useUI();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const selectedKind = (searchParams.get('kind') ?? 'all') as 'all' | PromptKind;
  const setSelectedKind = (kind: 'all' | PromptKind) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (kind === 'all') next.delete('kind'); else next.set('kind', kind);
      return next;
    }, { replace: true });
  };
  // SQEM-550 (b) — the selected playbook lives in the URL (?id=), so Back and a shared link work.
  // Below `lg` an id means "show the preview instead of the list".
  const selectedParam = searchParams.get('id');
  const selectPlaybook = useCallback((id: string) => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('id', id); return next; });
  }, [setSearchParams]);
  const backToList = () => setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('id'); return next; });
  const navigate = useNavigate();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // SQEM-564 — bulk tag and bulk access. One busy flag: both write to the same selection.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkAccessOpen, setBulkAccessOpen] = useState(false);
  const [bulkAccess, setBulkAccess] = useState<TemplateAccessValue>({ mode: 'restricted', userIds: [], groupIds: [] });
  const [accessGroups, setAccessGroups] = useState<{ id: string; name: string; memberIds: string[] }[]>([]);
  // SQEM-161 — export / import (.sqemes.zip bundle)
  const [exporting, setExporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importBundleData, setImportBundleData] = useState<{ zip: JSZip; manifest: BundleManifest } | null>(null);
  const [importSkillData, setImportSkillData] = useState<SkillBundle | null>(null); // SQEM-243
  const [importing, setImporting] = useState(false);
  // SQEM-163 — publish to marketplace
  const [publishTarget, setPublishTarget] = useState<Prompt | null>(null);
  const [publishCategory, setPublishCategory] = useState<TemplateCategory>('General');
  const [publishing, setPublishing] = useState(false);
  // SQEM-181 — Cloud always allows publishing; self-host only when a publisher token is configured
  // (the api-sidecar reports it). Gates the per-card Publish action.
  const [canPublish, setCanPublish] = useState(!IS_SELF_HOSTED);

  // SQEM-143 — which templates carry an access rule, and (SQEM-400) which word the badge says for
  // each: "Only me" for the principal-less row, "Restricted" for rules naming people or groups.
  // Re-fetches on mount (returning from the editor remounts this page) and when the set of
  // templates changes. Non-fatal — a failure just hides the badge.
  const [restrictedIds, setRestrictedIds] = useState<Map<string, AccessBadgeMode>>(new Map());
  useEffect(() => {
    if (!workspace?.id || IS_SELF_HOSTED) return; // SQEM-170 — template access is Cloud-only
    fetchRestrictedTemplateIds(workspace.id).then(setRestrictedIds).catch(() => {});
  }, [workspace?.id, prompts.length]);

  // SQEM-181 — on self-host, publishing is possible only if a publisher token is configured (server-side).
  useEffect(() => {
    if (IS_SELF_HOSTED) fetchCanPublish().then(setCanPublish).catch(() => {});
  }, []);

  // Shared workspace tag vocabulary (templates + files) — managed in one place.
  const allTags = useMemo(
    () => collectWorkspaceTags(prompts, workspaceFiles),
    [prompts, workspaceFiles]
  );

  const canEdit = can(currentUser, workspace, 'prompts:edit');
  // SQEM-308 — the Template Wizard, and the one condition it stands on.
  //
  // ⛔ Not rendered on self-host at all. It generates from the brand profile, which self-host does
  // not have in this form — and offering "Set up brand" there would send an operator to a page that
  // cannot help them, which is worse than the feature being absent.
  const [wizardOpen, setWizardOpen] = useState(false);
  const hasBrand = brandIsComplete(workspace?.brandProfile);
  const wizardButton = !IS_SELF_HOSTED && canEdit ? (
    hasBrand ? (
      <button
        onClick={() => setWizardOpen(true)}
        className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 px-5 py-2.5 rounded-xl font-medium text-sm transition-all"
      >
        <Sparkles className="w-4 h-4" /> {m.pb_wizard()}
      </button>
    ) : (
      /* The same slot, saying what is missing rather than sitting there disabled. A disabled button
         with a tooltip asks the person to hover to find out why; this one just tells them. */
      <Link
        to="/settings"
        state={{ initialTab: 'brand' }}
        title={m.pb_wizard_needs_brand()}
        className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 px-5 py-2.5 rounded-xl font-medium text-sm transition-all"
      >
        <Sparkles className="w-4 h-4" /> {m.pb_set_up_brand()}
      </Link>
    )
  ) : null;

  const filteredPrompts = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    const filtered = prompts.filter(p => {
      // SQEM-210 — no draft filter: RLS decides what a member may see (access rules), and this
      // list only ever holds what RLS already returned. Filtering on `published` here duplicated
      // that decision in the client, where it could only ever be the weaker of the two.
      const matchesSearch = p.title.toLowerCase().includes(lowerSearch) ||
                            p.description.toLowerCase().includes(lowerSearch);
      const matchesKind = selectedKind === 'all' || p.kind === selectedKind;
      const matchesTag = selectedTag ? p.tag === selectedTag : true;
      const matchesFavorite = showFavoritesOnly ? p.isFavorite : true;
      return matchesSearch && matchesKind && matchesTag && matchesFavorite;
    });

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [prompts, searchTerm, selectedKind, selectedTag, showFavoritesOnly, canEdit]);

  // SQEM-550 (b) — the playbook in the preview: the one in ?id= if it is in the list, else the first.
  const selectedPrompt = filteredPrompts.find(p => p.id === selectedParam) ?? filteredPrompts[0] ?? null;
  const showPreviewOnMobile = !!selectedParam && selectedPrompt?.id === selectedParam;

  // "Loaded by" — which personas route to which playbook. Loaded once per workspace; small list.
  const [loadedByMap, setLoadedByMap] = useState<Map<string, LoadedBy[]>>(new Map());
  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    fetchPersonas(workspace.id).then(personas => {
      if (cancelled) return;
      const map = new Map<string, LoadedBy[]>();
      for (const persona of personas) for (const r of persona.routes || []) {
        map.set(r.templateId, [...(map.get(r.templateId) || []), { id: persona.id, title: persona.title, condition: r.condition }]);
      }
      setLoadedByMap(map);
    }).catch(() => { /* the field then just says nobody loads it */ });
    return () => { cancelled = true; };
  }, [workspace?.id]);

  const handleDeleteRequest = useCallback((id: string) => {
    setPromptToDelete(id);
    setIsDeleteModalOpen(true);
  }, []);

  // --- Bulk selection ---
  const visibleIds = filteredPrompts.map(p => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  // --- SQEM-564 — bulk tag and bulk access ---
  const selectedPrompts = prompts.filter(p => selectedIds.has(p.id));
  // One tag per playbook: "Set tag" replaces it, "Remove tag" lists only tags the selection carries.
  const removableTags = [...new Set(selectedPrompts.map(p => p.tag).filter((t): t is string => !!t))].sort();
  const handleBulkTag = async (tag: string | null, ids: string[]) => {
    setBulkBusy(true);
    try {
      const outcome = await setTagMany(ids, tag);
      const { message, type } = bulkSummary(outcome, 'playbook', tag ? m.pb_tag_set({ tag }) : m.pb_tag_removed());
      showToast(message, type);
    } finally {
      setBulkBusy(false);
    }
  };

  // Cloud only and multi-seat only — the same condition under which the editor offers access at all.
  const canBulkAccess = canEdit && !IS_SELF_HOSTED && isMultiSeat(workspace);
  const openBulkAccess = () => {
    setBulkAccess({ mode: 'restricted', userIds: [], groupIds: [] });
    setBulkAccessOpen(true);
    if (workspace?.id) fetchGroups(workspace.id).then(setAccessGroups).catch(() => setAccessGroups([]));
  };
  // ⛔ "Restricted" with nobody named would be stored as the principal-less row — "Only me", which bulk
  // deliberately does not offer (SQEM-564). So Apply waits for a name.
  const bulkAccessIncomplete = bulkAccess.mode === 'restricted'
    && bulkAccess.userIds.length === 0 && (bulkAccess.groupIds ?? []).length === 0;
  const loseSight = bulkAccess.mode === 'restricted' && currentUser
    ? wouldLoseSight(selectedPrompts, currentUser.id, { userIds: bulkAccess.userIds, groupIds: bulkAccess.groupIds ?? [] }, accessGroups)
    : 0;
  const handleBulkAccess = async () => {
    if (!workspace?.id || bulkAccessIncomplete) return;
    setBulkBusy(true);
    try {
      const byId = new Map(selectedPrompts.map(p => [p.id, p]));
      const outcome = await applyToEditable(
        [...byId.keys()],
        ids => fetchCanEditMany('template', ids),
        // Each playbook's own owner is stripped from its rows (SQEM-300) — the owner always has access.
        id => setTemplateAccess(id, workspace.id, accessValueToAccess(bulkAccess, byId.get(id)?.createdBy || null)),
      );
      fetchRestrictedTemplateIds(workspace.id).then(setRestrictedIds).catch(() => {});
      const { message, type } = bulkSummary(outcome, 'playbook', m.pb_access_changed());
      showToast(message, type);
      setBulkAccessOpen(false);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    await deletePrompts(Array.from(selectedIds));
    setBulkDeleting(false);
    setBulkConfirm(false);
    setSelectedIds(new Set());
  };

  const confirmDelete = () => {
    if (promptToDelete) {
      // SQEM-606 — the store reports the outcome once the server has answered; a toast here came
      // first, said success before anything happened, and was then replaced by the store's own.
      void deletePrompt(promptToDelete);
      setIsDeleteModalOpen(false);
      setPromptToDelete(null);
    }
  };

  const handleDuplicate = useCallback((prompt: Prompt) => {
    void duplicatePrompt(prompt); // SQEM-606 — the store reports the outcome
  }, [duplicatePrompt]);

  const toggleFavorite = useCallback((prompt: Prompt) => {
    storeFavorite(prompt);
    showToast(prompt.isFavorite ? m.pb_unfavourited_toast() : m.pb_favourited_toast(), "success");
  }, [storeFavorite, showToast]);

  const handleSetTag = useCallback((prompt: Prompt, tag: string | null) => {
    updatePrompt({ ...prompt, tag });
  }, [updatePrompt]);

  // --- Export / Import (SQEM-161) ---
  const handleBulkExport = async () => {
    const selected = prompts.filter(p => selectedIds.has(p.id));
    if (!selected.length) return;
    setExporting(true);
    try {
      const blob = await exportTemplatesToZip(selected, workspaceFiles);
      const base = selected.length === 1
        ? selected[0].title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'playbook'
        : `sqemes-playbooks-${selected.length}`;
      downloadBlob(blob, `${base}.sqemes.zip`);
      showToast(m.pb_exported({ count: selected.length }), 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.pb_export_failed(), 'error');
    } finally {
      setExporting(false);
    }
  };

  // SQEM-302 — one template, the same bundle the multi-select export writes. Two entry points, one
  // format: the person who clicks a card and the person who ticks a checkbox get the same file.
  const handleExportSkill = async (template: Prompt) => {
    setExporting(true);
    try {
      downloadBlob(await exportTemplatesToZip([template], workspaceFiles), `${toSlug(template.title)}.sqemes.zip`);
      showToast(m.pb_downloaded(), 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.pb_export_failed(), 'error');
    } finally {
      setExporting(false);
    }
  };

  // One Import button, two formats. A second control would make the person choose which kind of zip
  // they are holding — a question the file itself answers: a Sqemes bundle has a manifest, an Agent
  // Skill has a SKILL.md. Try ours first, fall back to theirs, and only then report a failure.
  //
  // ⚠️ **Which error to report is decided by the file, not by the order of attempts (SQEM-250).**
  // It used to always report the bundle error, on the reasoning that "manifest.json missing"
  // describes what we opened. For a file that is genuinely neither, that is right. For a repo zip
  // holding a perfectly good SKILL.md it is the most misleading sentence available — it sent the
  // product owner to the conclusion that skill import was never built. `SkillArchiveError.kind`
  // separates the two: only `'none'` means "might not be a skill at all".
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    try {
      setImportBundleData(await readBundle(file));
    } catch (bundleErr) {
      try {
        setImportSkillData(await readSkillZip(file));
      } catch (skillErr) {
        showToast(importErrorMessage(bundleErr, skillErr), 'error');
      }
    }
  };

  const confirmSkillImport = async () => {
    if (!importSkillData || !workspace?.id) return;
    setImporting(true);
    try {
      const { files } = await importSkillBundle(importSkillData, workspace.id, currentUser.id);
      files.forEach(addWorkspaceFile); // the skill itself arrives via the store's realtime subscription
      showToast(m.pb_imported_skill({ title: importSkillData.title, count: files.length }), 'success');
      setImportSkillData(null);
    } catch (e) {
      showToast(errorMessage(e, m.pb_import_failed()), 'error');
    } finally {
      setImporting(false);
    }
  };

  // SQEM-183 — on self-host without a publisher key, the marketplace icon opens an "apply" modal instead.
  const [showApplyModal, setShowApplyModal] = useState(false);
  const openPublish = useCallback((prompt: Prompt) => {
    if (IS_SELF_HOSTED && !canPublish) { setShowApplyModal(true); return; }
    setPublishTarget(prompt);
    setPublishCategory('General');
  }, [canPublish]);

  const confirmPublish = async () => {
    if (!publishTarget || !workspace?.id) return;
    setPublishing(true);
    try {
      // SQEM-181 — self-host submits to the global Cloud marketplace through the api-sidecar proxy
      // (which holds the publisher token); Cloud publishes directly against its own Supabase.
      if (IS_SELF_HOSTED) {
        await submitToMarketplaceViaProxy(publishTarget, workspaceFiles, publishCategory);
      } else {
        await publishToMarketplace({ workspaceId: workspace.id, template: publishTarget, allFiles: workspaceFiles, userId: currentUser.id, category: publishCategory });
      }
      showToast(m.pb_submitted(), 'success');
      setPublishTarget(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.pb_publish_failed(), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const confirmImport = async () => {
    if (!importBundleData || !workspace?.id) return;
    setImporting(true);
    try {
      const { templates, personas, files } = await importBundle(importBundleData.zip, importBundleData.manifest, workspace.id, currentUser.id);
      files.forEach(addWorkspaceFile); // prompts arrive via the store's realtime subscription
      // SQEM-330 — personas only appear in the count when the bundle carried any, so an ordinary
      // template import reads exactly as it did before.
      showToast(
        m.pb_imported_playbooks({ count: templates }) +
        (personas ? m.pb_imported_and_personas({ count: personas }) : ''),
        'success',
      );
      setImportBundleData(null);
    } catch (e) {
      showToast(errorMessage(e, m.pb_import_failed()), 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto">
      <PageHeader
        title={m.pb_title()}
        subtitle={m.pb_subtitle()}
        actions={canEdit && (
          <>
            <input ref={importInputRef} type="file" accept=".zip,.sqemes" onChange={handleImportFile} className="hidden" />
            <button
              onClick={() => importInputRef.current?.click()}
              title={m.pb_import_title()}
              className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2.5 rounded-xl font-medium text-sm transition-all justify-center"
            >
              <Upload className="w-4 h-4" /> {m.pb_import()}
            </button>
            {wizardButton}
            <Link to="/playbooks/new" className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg shadow-brand-200 hover:shadow-brand-300 dark:shadow-none dark:hover:shadow-none flex-1 sm:flex-none justify-center">
              <Plus className="w-5 h-5" /> {m.pb_new()}
            </Link>
          </>
        )}
      />

      {/* Search + Sort + Filters */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={m.pb_search()}
        />
        {/* Favorites */}
        <button
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          className={`flex items-center gap-1.5 self-stretch px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${showFavoritesOnly ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
        >
          <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
          {m.pb_favorites()}
        </button>

        {/* Kind tabs */}
        <SegmentedTabs<'all' | PromptKind>
          value={selectedKind}
          onChange={setSelectedKind}
          className="self-stretch"
          tabs={[
            { value: 'all', label: m.pb_tab_all() },
            // SQEM-384 — the same one-liners the cards show on hover, at the place people filter.
            { value: 'prompt', label: m.pb_tab_prompts(), icon: <PenTool className="w-3 h-3" />, title: kindHelp('prompt') },
            { value: 'skill', label: m.pb_tab_skills(), icon: <Wand2 className="w-3 h-3" />, title: kindHelp('skill') },
          ]}
        />

        {/* Tags dropdown — only shown when tags exist */}
        {allTags.length > 0 && (
          <TagFilter tags={allTags} value={selectedTag} onChange={setSelectedTag} />
        )}

      </div>

      {/* Bulk selection bar */}
      {canEdit && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          total={visibleIds.length}
          allSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          onDelete={() => setBulkConfirm(true)}
          onClear={() => setSelectedIds(new Set())}
          noun="playbook"
          onExport={handleBulkExport}
          exporting={exporting}
          addableTags={allTags}
          removableTags={removableTags}
          addTagLabel={m.bulk_set_tag()}
          onAddTag={tag => void handleBulkTag(tag, selectedPrompts.map(p => p.id))}
          onRemoveTag={tag => void handleBulkTag(null, selectedPrompts.filter(p => p.tag === tag).map(p => p.id))}
          tagBusy={bulkBusy}
          onAccess={canBulkAccess ? openBulkAccess : undefined}
        />
      )}

      {isLoading && (
        <div className="lg:max-w-sm rounded-card border border-line bg-surface-raised p-2 mb-8">
          {Array.from({ length: 6 }).map((_, i) => <PromptSkeleton key={i} />)}
        </div>
      )}

      {/* SQEM-287 — this used to read "Create your first prompt, assistant, or skill": it named the
          kinds and explained none. It is the first screen every new user sees, because a
          library is necessarily empty on day one — the worst possible place to assume the words are
          self-evident. A customer had assistant and skill the wrong way round after using the
          product, which is how we know they are not. Text comes from KIND_HELP so this screen and
          the editor cannot drift apart. */}
      {!isLoading && prompts.length === 0 && (
        <EmptyState
          icon={<Plus className="w-8 h-8" />}
          tone="brand"
          title={m.pb_empty_title()}
          description={m.pb_empty_description()}
          extra={
            <dl className="mt-4 space-y-2 text-left max-w-md mx-auto">
              {(['prompt', 'skill'] as const).map(k => (
                <div key={k} className="flex gap-2.5">
                  <dt className="text-xs font-bold text-slate-700 dark:text-slate-200 w-[4.5rem] shrink-0 capitalize pt-px">{k}</dt>
                  <dd className="text-xs text-slate-500 dark:text-slate-400">{kindHelp(k)}</dd>
                </div>
              ))}
            </dl>
          }
          action={canEdit ? (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/playbooks/new" className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-brand-200 dark:shadow-none">
                <Plus className="w-4 h-4" /> {m.pb_create_first()}
              </Link>
              <Link to="/library" className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">
                <Store className="w-4 h-4" /> {m.pb_browse_marketplace()}
              </Link>
              {wizardButton}
            </div>
          ) : undefined}
        />
      )}

      {!isLoading && prompts.length > 0 && filteredPrompts.length === 0 && (
        <EmptyState
          icon={showFavoritesOnly ? <Star className="w-8 h-8 text-amber-300" /> : <Search className="w-8 h-8" />}
          title={showFavoritesOnly ? m.pb_no_favourites() : m.pb_none_found()}
          description={showFavoritesOnly ? m.pb_star_hint() : m.pb_adjust_filters()}
        />
      )}

      {/* SQEM-550 (b) — redesign C: the list on the left, the selected playbook on the right. Below
          `lg` one at a time: the list, or (with ?id=) the preview with a way back. */}
      {!isLoading && filteredPrompts.length > 0 && (
        <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-6 lg:items-start">
          <ul aria-label={m.pb_list_label()} className={`rounded-card border border-line bg-surface-raised p-2 space-y-0.5 ${showPreviewOnMobile ? 'hidden lg:block' : ''}`}>
            {filteredPrompts.map(prompt => (
              <PlaybookRow
                key={prompt.id}
                prompt={prompt}
                canEdit={canEdit}
                accessMode={restrictedIds.get(prompt.id)}
                active={selectedPrompt?.id === prompt.id}
                selected={selectedIds.has(prompt.id)}
                onSelect={selectPlaybook}
                onToggleSelect={toggleSelect}
                onFavorite={toggleFavorite}
              />
            ))}
          </ul>
          {selectedPrompt && (
            <div className={`lg:sticky lg:top-4 ${showPreviewOnMobile ? '' : 'hidden lg:block'}`}>
              <PlaybookPreview
                prompt={selectedPrompt}
                canEdit={canEdit}
                accessMode={restrictedIds.get(selectedPrompt.id)}
                workspaceTags={workspace.tags}
                loadedBy={loadedByMap.get(selectedPrompt.id) || []}
                showPublish={true}
                onUse={p => navigate('/chat', { state: { launchTemplateId: p.id } })}
                onDuplicate={handleDuplicate}
                onExport={handleExportSkill}
                onPublish={openPublish}
                onDelete={handleDeleteRequest}
                onSetTag={handleSetTag}
                onFavorite={toggleFavorite}
                onBack={backToList}
              />
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">{m.pb_delete_title()}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{m.pb_delete_body()}</p>
        <div className="flex gap-2">
          <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">{m.pb_cancel()}</button>
          <Button variant="danger" onClick={confirmDelete} className="flex-1 py-2.5 text-xs shadow-lg hover:shadow-red-200">{m.pb_yes_delete()}</Button>
        </div>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal open={bulkConfirm} onClose={() => !bulkDeleting && setBulkConfirm(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
          {m.pb_bulk_delete_title({ count: selectedIds.size })}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {m.pb_bulk_delete_body({ count: selectedIds.size })}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setBulkConfirm(false)}
            disabled={bulkDeleting}
            className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50"
          >
            {m.pb_cancel()}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
          >
            {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {bulkDeleting ? m.pb_deleting() : m.pb_delete()}
          </button>
        </div>
      </Modal>

      {/* SQEM-564 — access for several playbooks at once. Replaces what each of them had; no "Only me". */}
      <Modal open={bulkAccessOpen} onClose={() => !bulkBusy && setBulkAccessOpen(false)} size="md" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-1">
          {m.pb_bulk_access_title({ count: selectedIds.size })}
        </h3>
        <p className="text-sm text-ink-muted mb-5">
          {m.pb_bulk_access_body()}
        </p>
        <TemplateAccessControl
          value={bulkAccess}
          onChange={setBulkAccess}
          hint={m.pb_bulk_access_hint()}
          members={workspace?.members}
          groups={accessGroups}
          multiSeat={isMultiSeat(workspace)}
        />
        {bulkAccessIncomplete && (
          <p className="mt-3 text-xs text-ink-muted">{m.pb_pick_someone()}</p>
        )}
        {!bulkAccessIncomplete && loseSight > 0 && (
          <p className="mt-3 text-xs text-ink">
            {m.pb_lose_sight({ count: loseSight })}
          </p>
        )}
        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={() => setBulkAccessOpen(false)} disabled={bulkBusy}>{m.pb_cancel()}</Button>
          <Button className="flex-1" onClick={() => void handleBulkAccess()} disabled={bulkAccessIncomplete} loading={bulkBusy}>
            {bulkBusy ? m.pb_applying() : m.pb_apply()}
          </Button>
        </div>
      </Modal>

      {/* Publish to Marketplace (SQEM-163) */}
      <Modal open={!!publishTarget} onClose={() => !publishing && setPublishTarget(null)} size="sm" className="p-6">
        {publishTarget && (
          <>
            <div className="flex items-center gap-2.5 mb-2">
              <Store className="w-6 h-6 text-brand-500" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{m.pb_publish_title()}</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              {m.pb_publish_1()} <span className="font-semibold">{publishTarget.title}</span> {m.pb_publish_2()}{' '}
              <span className="font-semibold">{m.pb_publish_3()}</span> {m.pb_publish_4()}
              {publishTarget.kind === 'skill' && <span className="block mt-1 text-amber-600 dark:text-amber-400">{m.pb_publish_skill_review()}</span>}
            </p>
            <label htmlFor="templates-category" className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">{m.pb_category()}</label>
            <Select id="templates-category" value={publishCategory} onChange={e => setPublishCategory(e.target.value as TemplateCategory)}
              className="mb-5">
              {TEMPLATE_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </Select>
            <div className="flex gap-2">
              <button onClick={() => setPublishTarget(null)} disabled={publishing} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50">{m.pb_cancel()}</button>
              <button onClick={confirmPublish} disabled={publishing} className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {publishing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.pb_submitting()}</> : m.pb_submit_review()}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* SQEM-183 — self-host without a publisher key: prompt to apply instead of publishing */}
      <Modal open={showApplyModal} onClose={() => setShowApplyModal(false)} size="sm" className="p-6">
        <div className="flex items-center gap-2.5 mb-2">
          <Store className="w-6 h-6 text-brand-500" />
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{m.pb_need_key_title()}</h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {m.pb_need_key_1()} <span className="font-semibold">{m.pb_need_key_2()}</span>{m.pb_need_key_3()} <span className="font-semibold">{m.pb_need_key_4()}</span>.
        </p>
        <div className="flex gap-2">
          <button onClick={() => setShowApplyModal(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">{m.pb_cancel()}</button>
          <a href="https://sqemes.com/publisher" target="_blank" rel="noopener noreferrer" onClick={() => setShowApplyModal(false)} className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
            {m.pb_more_info()}
          </a>
        </div>
      </Modal>

      {wizardOpen && <TemplateWizardModal open onClose={() => setWizardOpen(false)} />}

      {/* Import preview (SQEM-161) — transparency before applying a third-party bundle */}
      <Modal open={!!importBundleData} onClose={() => !importing && setImportBundleData(null)} size="sm" className="p-6">
        {importBundleData && (() => {
          const { templates, files, personas } = importBundleData.manifest;
          const totalBytes = (files || []).reduce((s, f) => s + (f.sizeBytes || 0), 0);
          const mb = (totalBytes / (1024 * 1024));
          return (
            <>
              <div className="flex items-center gap-2.5 mb-2">
                <Package className="w-6 h-6 text-brand-500" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{m.pb_import_bundle_title()}</h3>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                {m.pb_import_bundle_1()} <span className="font-semibold">{workspace.name}</span>{m.pb_import_bundle_2()}
              </p>
              <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-4 mb-4 text-sm">
                <div className="flex justify-between py-1"><span className="text-slate-500 dark:text-slate-400">{m.pb_import_playbooks()}</span><span className="font-bold text-slate-800 dark:text-slate-100">{(templates || []).length}</span></div>
                <div className="flex justify-between py-1"><span className="text-slate-500 dark:text-slate-400">{m.pb_import_context_files()}</span><span className="font-bold text-slate-800 dark:text-slate-100">{(files || []).length}{totalBytes ? ` · ${mb < 0.1 ? '<0.1' : mb.toFixed(1)} MB` : ''}</span></div>
                {/* ⛔ SQEM-330 — this row was missing, and its absence was the bug. `importBundle`
                    has created personas since SQEM-330 and the success toast counts them, but this
                    dialog — whose entire job is "review what lands before continuing" — listed only
                    templates and files. A preview that omits part of what it is about to create is
                    worse than no preview: it was *read* as complete. Shown only when the bundle
                    carries any, so an ordinary template import looks exactly as it did. */}
                {(personas || []).length > 0 && (
                  <div className="flex justify-between py-1"><span className="text-slate-500 dark:text-slate-400">{m.pb_import_personas()}</span><span className="font-bold text-slate-800 dark:text-slate-100">{(personas || []).length}</span></div>
                )}
              </div>
              {(templates || []).length > 0 && (
                <ul className="mb-5 max-h-32 overflow-y-auto text-sm text-slate-700 dark:text-slate-200 space-y-1">
                  {(templates || []).slice(0, 8).map((t, i) => (
                    <li key={i} className="flex items-center gap-2 truncate"><span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />{t.title || m.pb_untitled()}</li>
                  ))}
                  {(templates || []).length > 8 && <li className="text-slate-400 text-xs">{m.pb_more({ count: (templates || []).length - 8 })}</li>}
                </ul>
              )}
              <div className="flex gap-2">
                <button onClick={() => setImportBundleData(null)} disabled={importing} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50">{m.pb_cancel()}</button>
                <button onClick={confirmImport} disabled={importing || !((templates || []).length || (personas || []).length)} className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.pb_importing()}</> : m.pb_import()}
                </button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* SQEM-243 — the same confirmation for an Agent Skill folder. Its own modal rather than a
          branch inside the one above: a skill bundle has no templates/files split to report,
          and folding two shapes into one dialog is how a preview stops previewing anything. */}
      <Modal open={!!importSkillData} onClose={() => !importing && setImportSkillData(null)} size="sm" className="p-6">
        {importSkillData && (() => {
          const bytes = importSkillData.files.reduce((n, f) => n + f.blob.size, 0);
          const mb = bytes / (1024 * 1024);
          const dirs = new Set(importSkillData.files.map(f => f.name.split('/').slice(0, -1).join('/')).filter(Boolean));
          return (
            <>
              <div className="flex items-center gap-2.5 mb-2">
                <FolderDown className="w-6 h-6 text-brand-500" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{m.pb_import_skill_title()}</h3>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                {m.pb_import_skill_1()} <span className="font-semibold">{workspace.name}</span> {m.pb_import_skill_2()}
              </p>
              <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-4 mb-4 text-sm">
                <div className="flex justify-between py-1 gap-4"><span className="text-slate-500 dark:text-slate-400 shrink-0">{m.pb_import_skill()}</span><span className="font-bold text-slate-800 dark:text-slate-100 truncate">{importSkillData.title}</span></div>
                <div className="flex justify-between py-1"><span className="text-slate-500 dark:text-slate-400">{m.pb_import_files()}</span><span className="font-bold text-slate-800 dark:text-slate-100">{importSkillData.files.length}{bytes ? ` · ${mb < 0.1 ? '<0.1' : mb.toFixed(1)} MB` : ''}</span></div>
                {dirs.size > 0 && (
                  <div className="flex justify-between py-1 gap-4"><span className="text-slate-500 dark:text-slate-400 shrink-0">{m.pb_import_folders()}</span><span className="font-bold text-slate-800 dark:text-slate-100 truncate">{Array.from(dirs).sort().join(' · ')}</span></div>
                )}
              </div>
              {importSkillData.files.length > 0 && (
                <ul className="mb-5 max-h-32 overflow-y-auto text-sm text-slate-700 dark:text-slate-200 space-y-1">
                  {importSkillData.files.slice(0, 8).map((f, i) => (
                    <li key={i} className="flex items-center gap-2 truncate"><span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />{f.name}</li>
                  ))}
                  {importSkillData.files.length > 8 && <li className="text-slate-400 text-xs">{m.pb_more({ count: importSkillData.files.length - 8 })}</li>}
                </ul>
              )}
              <div className="flex gap-2">
                <button onClick={() => setImportSkillData(null)} disabled={importing} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50">{m.pb_cancel()}</button>
                <button onClick={confirmSkillImport} disabled={importing} className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.pb_importing()}</> : m.pb_import()}
                </button>
              </div>
            </>
          );
        })()}
      </Modal>
    </div>
  );
};

export default Templates;