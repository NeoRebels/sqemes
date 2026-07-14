import React, { useState, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI, useWorkspace, useData, usePrompts } from '../store';
import { TEMPLATE_CATEGORIES, CATEGORY_COLORS } from '../constants';
import { can } from '../lib/permissions';
import { LibraryTemplate, TemplateCategory, PromptKind, Prompt, Step } from '../types';
import { fetchLibraryTemplateDetail } from '../lib/api/library';
import { adaptToBrand } from '../lib/adaptTemplate';
import { firstTextModelId } from '../lib/authoringAI';
import { Plus, FilePlus, Edit, Trash2, EyeOff, Layers, Loader2, Zap, PenTool, Bot, Wand2, Sparkles } from 'lucide-react';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import KindBadge from '../components/ui/KindBadge';
import TemplateCard from '../components/ui/TemplateCard';

const LibrarySkeleton = () => (
  <Card className="animate-pulse p-6 flex flex-col gap-3">
    <div className="flex items-start justify-between mb-1">
      <div className="h-5 w-20 bg-slate-100 rounded-lg" />
      <div className="h-5 w-14 bg-slate-100 rounded-lg" />
    </div>
    <div className="h-5 w-3/4 bg-slate-100 rounded-lg" />
    <div className="h-4 w-full bg-slate-100 rounded-lg" />
    <div className="h-4 w-5/6 bg-slate-100 rounded-lg" />
    <div className="flex gap-2 mt-1">
      <div className="h-4 w-12 bg-slate-100 rounded-lg" />
      <div className="h-4 w-16 bg-slate-100 rounded-lg" />
    </div>
    <div className="mt-auto pt-3 border-t border-slate-50 flex gap-2">
      <div className="h-9 flex-1 bg-slate-100 rounded-xl" />
      <div className="h-9 w-9 bg-slate-100 rounded-xl" />
    </div>
  </Card>
);

const Library = () => {
  const { libraryTemplates, copyTemplateToWorkspace, deleteLibraryTemplate } = useData();
  const { addPrompt } = usePrompts();
  const { currentUser, isSqemesAdmin, workspace } = useWorkspace();
  const { showToast, isLoading } = useUI();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'All'>('All');
  const [activeKind, setActiveKind] = useState<'all' | PromptKind>('all');
  const [search, setSearch] = useState('');
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);

  // SQEM-106 Phase 3 — "Adapt to my brand" needs an AI model + a saved brand profile.
  const modelId = firstTextModelId(workspace.apiKeys);
  const canUseAI = !!modelId || !!workspace.fundedAvailable;
  const brandProfile = workspace.brandProfile;
  const hasBrand = !!brandProfile?.brandName?.trim();
  const canAdapt = canUseAI && hasBrand;
  const adaptReason = !hasBrand
    ? 'Add your brand profile in Settings → Brand to adapt'
    : !canUseAI
      ? 'Connect an AI provider key to adapt'
      : '';

  const categoryOrder = useMemo(() => ['All', ...TEMPLATE_CATEGORIES], []);

  // Precompute index map so sort comparator is O(1) per lookup instead of O(n)
  const categoryIndexMap = useMemo(
    () => Object.fromEntries(categoryOrder.map((c, i) => [c, i])),
    [categoryOrder]
  );

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return libraryTemplates
      .filter(t => {
        if (activeKind !== 'all' && t.kind !== activeKind) return false;
        if (activeCategory !== 'All' && t.category !== activeCategory) return false;
        if (search) {
          return t.title.toLowerCase().includes(lowerSearch) ||
                 t.description.toLowerCase().includes(lowerSearch);
        }
        return true;
      })
      .sort((a, b) => {
        const diff = (categoryIndexMap[a.category] ?? 999) - (categoryIndexMap[b.category] ?? 999);
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });
  }, [libraryTemplates, activeKind, activeCategory, search, categoryIndexMap]);

  const handleCopy = useCallback(async (templateId: string) => {
    setCopyingId(templateId);
    try {
      const promptId = await copyTemplateToWorkspace(templateId);
      if (promptId) {
        navigate(`/prompts/${promptId}/edit`);
      }
    } finally {
      setCopyingId(null);
    }
  }, [copyTemplateToWorkspace, navigate]);

  const handleAdapt = useCallback(async (templateId: string) => {
    if (!canAdapt || !brandProfile) return;
    setAdaptingId(templateId);
    try {
      const tpl = await fetchLibraryTemplateDetail(templateId);
      const isAssistant = tpl.kind === 'assistant';
      const body = isAssistant
        ? (tpl.systemInstruction ?? '')
        : (((tpl.steps as Step[] | undefined)?.[0]?.content) ?? '');
      const adapted = await adaptToBrand(body, tpl.kind, brandProfile, { workspaceId: workspace.id, modelId });
      const now = new Date().toISOString();
      const created = await addPrompt({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        kind: tpl.kind,
        title: tpl.title,
        description: tpl.description,
        tag: tpl.tags?.[0] ?? null,
        variables: tpl.variables,
        content: isAssistant ? '' : adapted,
        systemInstruction: isAssistant ? adapted : tpl.systemInstruction,
        contextFileIds: [],
        skillIds: [],
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.id,
        usageCount: 0,
        published: true,
        sourceTemplateId: templateId,
      } as Prompt);
      if (created) {
        showToast('Adapted to your brand ✨', 'success');
        navigate(`/prompts/${created.id}/edit`);
      }
    } catch (err: any) {
      showToast(err.message || 'Adaptation failed', 'error');
    } finally {
      setAdaptingId(null);
    }
  }, [canAdapt, brandProfile, workspace.id, modelId, addPrompt, currentUser.id, showToast, navigate]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteLibraryTemplate(id);
    setDeleteModalId(null);
  }, [deleteLibraryTemplate]);

  const handleEdit = useCallback((id: string) => {
    navigate(`/library/${id}/edit`);
  }, [navigate]);

  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteModalId(id);
  }, []);

  const canSave = isSqemesAdmin || can(currentUser, workspace, 'library:copy');

  const handleUpgrade = useCallback(() => {
    navigate('/settings', { state: { initialTab: 'plans' } });
  }, [navigate]);

  const handleSetupBrand = useCallback(() => {
    navigate('/settings', { state: { initialTab: 'brand' } });
  }, [navigate]);

  const categories = ['All', ...TEMPLATE_CATEGORIES] as const;

  return (
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 md:mb-10 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Marketplace</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Browse and save templates to your workspace</p>
        </div>
        {isSqemesAdmin && (
          <button
            onClick={() => navigate('/library/new')}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg shadow-brand-200 hover:shadow-brand-300 dark:shadow-none dark:hover:shadow-none w-full sm:w-auto justify-center"
          >
            <Plus className="w-5 h-5" /> Add Template
          </button>
        )}
      </div>

      {/* Search + Kind filter — mirrors the Templates / Files bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search templates..."
        />
        <SegmentedTabs<'all' | PromptKind>
          value={activeKind}
          onChange={setActiveKind}
          className="self-stretch"
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'prompt', label: 'Prompts', icon: <PenTool className="w-3 h-3" /> },
            { value: 'assistant', label: 'Assistants', icon: <Bot className="w-3 h-3" /> },
            { value: 'skill', label: 'Skills', icon: <Wand2 className="w-3 h-3" /> },
          ]}
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-8 pb-1">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
              activeCategory === cat
                ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <LibrarySkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 border-dashed">
          <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8 text-slate-300 dark:text-slate-500" />
          </div>
          <h3 className="text-slate-900 dark:text-slate-100 font-bold text-lg">No templates found</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {search ? 'Try a different search term' : 'No templates in this category yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(template => (
            <MarketplaceCard
              key={template.id}
              template={template}
              isAdmin={isSqemesAdmin}
              canSave={canSave}
              isCopying={copyingId === template.id}
              isAdapting={adaptingId === template.id}
              canAdapt={canAdapt}
              hasBrand={hasBrand}
              adaptReason={adaptReason}
              onCopy={handleCopy}
              onAdapt={handleAdapt}
              onSetupBrand={handleSetupBrand}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
              onUpgrade={handleUpgrade}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteModalId} onClose={() => setDeleteModalId(null)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Delete Template?</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">This will permanently remove this template from the marketplace.</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleteModalId(null)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
          <Button variant="danger" onClick={() => handleDelete(deleteModalId!)} className="flex-1 py-2.5 text-xs shadow-lg hover:shadow-red-200">Yes, Delete</Button>
        </div>
      </Modal>
    </div>
  );
};

const MarketplaceCard = memo(({
  template,
  isAdmin,
  canSave,
  isCopying,
  isAdapting,
  canAdapt,
  hasBrand,
  adaptReason,
  onCopy,
  onAdapt,
  onSetupBrand,
  onEdit,
  onDelete,
  onUpgrade,
}: {
  template: LibraryTemplate;
  isAdmin: boolean;
  canSave: boolean;
  isCopying: boolean;
  isAdapting: boolean;
  canAdapt: boolean;
  hasBrand: boolean;
  adaptReason: string;
  onCopy: (id: string) => void;
  onAdapt: (id: string) => void;
  onSetupBrand: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onUpgrade: () => void;
}) => {
  const colors = CATEGORY_COLORS[template.category] || CATEGORY_COLORS.General;
  const busy = isCopying || isAdapting;

  return (
    <TemplateCard
      topRight={isAdmin && (
        <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(template.id)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors bg-white/80 dark:bg-slate-800/80" title="Edit">
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(template.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors bg-white/80 dark:bg-slate-800/80" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      badges={(
        <>
          <KindBadge kind={template.kind} />
          <span className={`text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${colors.bg} ${colors.text}`}>
            {template.category}
          </span>
          {!template.published && isAdmin && (
            <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 flex items-center gap-1">
              <EyeOff className="w-3 h-3" /> Draft
            </span>
          )}
        </>
      )}
      title={template.title}
      description={template.description}
      footerRight={canSave ? (
        <div className="flex items-center gap-1.5 flex-1">
          {!hasBrand ? (
            <button
              onClick={onSetupBrand}
              disabled={busy}
              title="Set up your brand profile to adapt templates to your brand"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-xs font-bold rounded-lg hover:bg-violet-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" /> Set up brand
            </button>
          ) : (
            <button
              onClick={() => onAdapt(template.id)}
              disabled={busy || !canAdapt}
              title={canAdapt ? 'Adapt this template to your brand' : adaptReason}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-xs font-bold rounded-lg hover:bg-violet-700 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isAdapting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isAdapting ? 'Adapting…' : 'Adapt to brand'}
            </button>
          )}
          <button
            onClick={() => onCopy(template.id)}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-xs font-bold rounded-lg hover:bg-brand-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCopying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FilePlus className="w-3.5 h-3.5" />}
            Add to templates
          </button>
        </div>
      ) : (
        <button
          onClick={onUpgrade}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-all shadow-sm"
        >
          <Zap className="w-3.5 h-3.5 fill-white" />
          Upgrade to Save
        </button>
      )}
    />
  );
});

export default Library;
