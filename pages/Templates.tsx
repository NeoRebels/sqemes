import React, { useState, useMemo, useCallback, memo } from 'react';
import { useUI, useWorkspace, usePrompts, useData } from '../store';
import { collectWorkspaceTags } from '../lib/workspaceTags';
import { can } from '../lib/permissions';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, Play, Edit, Trash2, Copy, Star, EyeOff, Bot, PenTool, Wand2, Loader2 } from 'lucide-react';
import Card from '../components/ui/Card';
import TemplateCard from '../components/ui/TemplateCard';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import BulkActionBar from '../components/ui/BulkActionBar';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import EmptyState from '../components/ui/EmptyState';
import TagFilter from '../components/ui/TagFilter';
import TagEditor from '../components/ui/TagEditor';
import KindBadge from '../components/ui/KindBadge';
import { Prompt, PromptKind } from '../types';

const PromptSkeleton = () => (
  <Card className="animate-pulse p-4 flex flex-col gap-3">
    <div className="flex justify-between items-start">
      <div className="flex gap-2">
        <div className="h-5 w-14 bg-slate-100 rounded-lg" />
        <div className="h-5 w-20 bg-slate-100 rounded-lg" />
      </div>
      <div className="w-5 h-5 bg-slate-100 rounded-full" />
    </div>
    <div className="h-5 w-3/4 bg-slate-100 rounded-lg mt-1" />
    <div className="h-4 w-full bg-slate-100 rounded-lg" />
    <div className="h-4 w-2/3 bg-slate-100 rounded-lg" />
    <div className="mt-auto pt-3 flex justify-between items-center">
      <div className="h-4 w-16 bg-slate-100 rounded-lg" />
      <div className="h-8 w-24 bg-slate-100 rounded-xl" />
    </div>
  </Card>
);

const PromptCard = memo(({
  prompt,
  canEdit,
  workspaceTags,
  selected,
  onToggleSelect,
  onFavorite,
  onDuplicate,
  onDeleteRequest,
  onRun,
  onSetTag,
}: {
  prompt: Prompt;
  canEdit: boolean;
  workspaceTags: string[];
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onFavorite: (prompt: Prompt) => void;
  onDuplicate: (prompt: Prompt) => void;
  onDeleteRequest: (id: string) => void;
  onRun: (prompt: Prompt) => void;
  onSetTag: (prompt: Prompt, tag: string | null) => void;
}) => (
  <TemplateCard
    selected={selected}
    topLeft={canEdit && (
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(prompt.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${prompt.title}`}
        className={`absolute top-2.5 left-2.5 z-10 w-4 h-4 rounded accent-brand-600 cursor-pointer bg-white dark:bg-slate-800 shadow transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
      />
    )}
    topRight={(
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFavorite(prompt); }}
        className="absolute top-3 right-3 z-10 p-2 text-slate-300 hover:text-amber-400 hover:scale-110 transition-all focus:outline-none"
        title={prompt.isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <Star className={`w-5 h-5 ${prompt.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
      </button>
    )}
    badges={(
      <>
        <KindBadge kind={prompt.kind} />
        {prompt.published === false && canEdit && (
          <span className="text-2xs font-bold px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg uppercase tracking-wider flex items-center gap-1">
            <EyeOff className="w-3 h-3" /> Draft
          </span>
        )}
        <TagEditor
          tags={prompt.tag ? [prompt.tag] : []}
          available={canEdit && !prompt.tag ? workspaceTags : []}
          canEdit={canEdit}
          onAdd={(tag) => onSetTag(prompt, tag)}
          onRemove={() => onSetTag(prompt, null)}
        />
      </>
    )}
    title={prompt.title}
    titleHref={`/prompts/${prompt.id}`}
    description={prompt.description}
    footerLeft={canEdit && (
      <>
        <Link to={`/prompts/${prompt.id}/edit`} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors" title="Edit">
          <Edit className="w-4 h-4" />
        </Link>
        <button
          onClick={(e) => { e.preventDefault(); onDuplicate(prompt); }}
          className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
          title="Duplicate"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.preventDefault(); onDeleteRequest(prompt.id); }}
          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </>
    )}
    footerRight={(
      <button
        onClick={e => { e.preventDefault(); onRun(prompt); }}
        className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-xs font-bold rounded-lg hover:bg-brand-700 transition-all shadow-sm"
      >
        <Play className="w-3 h-3" /> Use in Chat
      </button>
    )}
  />
));

const Templates = () => {
  const { prompts, deletePrompt, deletePrompts, duplicatePrompt, toggleFavorite: storeFavorite, updatePrompt } = usePrompts();
  const { workspaceFiles } = useData();
  const { currentUser, workspace } = useWorkspace();
  const { showToast, isLoading } = useUI();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const selectedKind = (searchParams.get('kind') ?? 'all') as 'all' | PromptKind;
  const setSelectedKind = (kind: 'all' | PromptKind) => {
    setSearchParams(kind === 'all' ? {} : { kind }, { replace: true });
  };
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Shared workspace tag vocabulary (templates + files) — managed in one place.
  const allTags = useMemo(
    () => collectWorkspaceTags(prompts, workspaceFiles),
    [prompts, workspaceFiles]
  );

  const canEdit = can(currentUser, workspace, 'prompts:edit');

  const filteredPrompts = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    const filtered = prompts.filter(p => {
      if (p.published === false && !canEdit) return false;
      const matchesSearch = p.title.toLowerCase().includes(lowerSearch) ||
                            p.description.toLowerCase().includes(lowerSearch);
      const matchesKind = selectedKind === 'all' || p.kind === selectedKind;
      const matchesTag = selectedTag ? p.tag === selectedTag : true;
      const matchesFavorite = showFavoritesOnly ? p.isFavorite : true;
      return matchesSearch && matchesKind && matchesTag && matchesFavorite;
    });

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [prompts, searchTerm, selectedKind, selectedTag, showFavoritesOnly, canEdit]);

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

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    await deletePrompts(Array.from(selectedIds));
    setBulkDeleting(false);
    setBulkConfirm(false);
    setSelectedIds(new Set());
  };

  const confirmDelete = () => {
    if (promptToDelete) {
      deletePrompt(promptToDelete);
      setIsDeleteModalOpen(false);
      setPromptToDelete(null);
      showToast("Prompt deleted", "success");
    }
  };

  const handleDuplicate = useCallback((prompt: Prompt) => {
    duplicatePrompt(prompt);
    showToast("Prompt duplicated", "success");
  }, [duplicatePrompt, showToast]);

  const toggleFavorite = useCallback((prompt: Prompt) => {
    storeFavorite(prompt);
    showToast(prompt.isFavorite ? "Removed from favorites" : "Added to favorites", "success");
  }, [storeFavorite, showToast]);

  const handleRun = useCallback((prompt: Prompt) => {
    navigate('/chat', { state: { launchTemplateId: prompt.id } });
  }, [navigate]);

  const handleSetTag = useCallback((prompt: Prompt, tag: string | null) => {
    updatePrompt({ ...prompt, tag });
  }, [updatePrompt]);

  return (
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 md:mb-10 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Templates</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Manage and organize your team's prompts, assistants, and skills</p>
        </div>
        {canEdit && (
          <Link to="/prompts/new" className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg shadow-brand-200 hover:shadow-brand-300 dark:shadow-none dark:hover:shadow-none w-full sm:w-auto justify-center">
            <Plus className="w-5 h-5" /> New Template
          </Link>
        )}
      </div>

      {/* Search + Sort + Filters */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search templates..."
        />
        {/* Favorites */}
        <button
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          className={`flex items-center gap-1.5 self-stretch px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${showFavoritesOnly ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
        >
          <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
          Favorites
        </button>

        {/* Kind tabs */}
        <SegmentedTabs<'all' | PromptKind>
          value={selectedKind}
          onChange={setSelectedKind}
          className="self-stretch"
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'prompt', label: 'Prompts', icon: <PenTool className="w-3 h-3" /> },
            { value: 'assistant', label: 'Assistants', icon: <Bot className="w-3 h-3" /> },
            { value: 'skill', label: 'Skills', icon: <Wand2 className="w-3 h-3" /> },
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
          noun="template"
        />
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {Array.from({ length: 6 }).map((_, i) => <PromptSkeleton key={i} />)}
        </div>
      )}

      {!isLoading && prompts.length === 0 && (
        <EmptyState
          icon={<Plus className="w-8 h-8 text-brand-400" />}
          iconWrapClassName="bg-brand-50 dark:bg-brand-900/20"
          title="No templates yet"
          description="Create your first prompt, assistant, or skill."
          action={canEdit ? (
            <Link to="/prompts/new" className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-brand-200 dark:shadow-none">
              <Plus className="w-4 h-4" /> Create your first template
            </Link>
          ) : undefined}
        />
      )}

      {!isLoading && prompts.length > 0 && filteredPrompts.length === 0 && (
        <EmptyState
          icon={showFavoritesOnly ? <Star className="w-8 h-8 text-amber-300" /> : <Search className="w-8 h-8 text-slate-300 dark:text-slate-500" />}
          title={showFavoritesOnly ? 'No favourite templates' : 'No templates found'}
          description={showFavoritesOnly ? 'Star templates to see them here.' : 'Try adjusting your search or filters.'}
        />
      )}

      {!isLoading && filteredPrompts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPrompts.map(prompt => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              canEdit={canEdit}
              workspaceTags={workspace.tags}
              selected={selectedIds.has(prompt.id)}
              onToggleSelect={toggleSelect}
              onFavorite={toggleFavorite}
              onDuplicate={handleDuplicate}
              onDeleteRequest={handleDeleteRequest}
              onRun={handleRun}
              onSetTag={handleSetTag}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Delete Template?</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Are you sure you want to delete this template? This action cannot be undone.</p>
        <div className="flex gap-2">
          <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
          <Button variant="danger" onClick={confirmDelete} className="flex-1 py-2.5 text-xs shadow-lg hover:shadow-red-200">Yes, Delete</Button>
        </div>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal open={bulkConfirm} onClose={() => !bulkDeleting && setBulkConfirm(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
          Delete {selectedIds.size} template{selectedIds.size === 1 ? '' : 's'}?
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          This permanently deletes the selected template{selectedIds.size === 1 ? '' : 's'}. This action cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setBulkConfirm(false)}
            disabled={bulkDeleting}
            className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
          >
            {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {bulkDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default Templates;