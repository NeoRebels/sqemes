import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useUI, useWorkspace, useData } from '../store';
import { IS_SELF_HOSTED } from '../lib/env';
import { TEMPLATE_CATEGORIES, CATEGORY_COLORS } from '../constants';
import { LibraryTemplate, TemplateCategory, PromptKind } from '../types';
import { voteListing, fetchMyVotes } from '../lib/api/library';
import { Edit, Trash2, EyeOff, ArrowUpRight, Flame, Snowflake, PenTool, Bot, Wand2, Layers } from 'lucide-react';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import KindBadge from '../components/ui/KindBadge';
import TemplateCard from '../components/ui/TemplateCard';
import MarketplaceAdminEntry from '../components/MarketplaceAdminEntry';

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
  const { libraryTemplates, deleteLibraryTemplate } = useData();
  const { isSqemesAdmin } = useWorkspace();
  // SQEM-178 — on self-host the marketplace is the global Cloud one (read-only): no admin
  // moderation, no voting, no publishing here. Those live on the Cloud that owns the queue.
  const showAdmin = isSqemesAdmin && !IS_SELF_HOSTED;
  const { showToast, isLoading } = useUI();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'All'>('All');
  const [activeKind, setActiveKind] = useState<'all' | PromptKind>('all');
  const [search, setSearch] = useState('');
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);
  // SQEM-169 — votes on cards (myVote + optimistic score override per listing)
  const [myVotes, setMyVotes] = useState<Record<string, number>>({});
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    if (IS_SELF_HOSTED) return; // voting is Cloud-only (needs an account)
    fetchMyVotes().then(setMyVotes).catch(() => {});
  }, []);

  const handleVote = useCallback(async (listingId: string, baseScore: number, value: 1 | -1) => {
    const prev = myVotes[listingId] ?? 0;
    const next = prev === value ? 0 : value; // toggle off
    const current = scoreOverrides[listingId] ?? baseScore;
    setMyVotes(m => ({ ...m, [listingId]: next }));
    setScoreOverrides(s => ({ ...s, [listingId]: current - prev + next }));
    try { await voteListing(listingId, value); }
    catch (e) {
      setMyVotes(m => ({ ...m, [listingId]: prev }));
      setScoreOverrides(s => ({ ...s, [listingId]: current }));
      showToast(e instanceof Error ? e.message : 'Vote failed', 'error');
    }
  }, [myVotes, scoreOverrides, showToast]);

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

  const categories = ['All', ...TEMPLATE_CATEGORIES] as const;

  return (
    <div className="p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 md:mb-10 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Marketplace</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Browse and save templates to your workspace</p>
        </div>
        {/* SQEM-182 — Cloud-admin moderation + publishers, in a self-contained overlay (stubbed to null
            on self-host, so no admin surface ships there). */}
        <MarketplaceAdminEntry />
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
              isAdmin={showAdmin}
              canVote={!IS_SELF_HOSTED}
              score={scoreOverrides[template.id] ?? template.score ?? 0}
              myVote={myVotes[template.id] ?? 0}
              onVote={handleVote}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
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
  canVote,
  score,
  myVote,
  onVote,
  onEdit,
  onDelete,
}: {
  template: LibraryTemplate;
  isAdmin: boolean;
  canVote: boolean;
  score: number;
  myVote: number;
  onVote: (id: string, baseScore: number, value: 1 | -1) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const colors = CATEGORY_COLORS[template.category] || CATEGORY_COLORS.General;

  return (
    <TemplateCard
      topRight={isAdmin && (
        // SQEM-168 — bigger padding + gap so the hover admin buttons clear the stretched card link.
        <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(template.id)} className="p-2.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors bg-white/80 dark:bg-slate-800/80" title="Edit">
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(template.id)} className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors bg-white/80 dark:bg-slate-800/80" title="Delete">
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
      titleHref={`/library/${template.id}`}
      description={template.description}
      footerLeft={canVote && (
        // SQEM-169 — temperature votes on the card: 🔥 hot (red) vs ❄️ cold (ice-blue); score in degrees.
        // h-8 (32px) = the exact height of the py-2 text-xs "See template details" button beside it.
        // SQEM-178 — hidden on self-host (voting needs a Cloud account).
        <div className="flex items-stretch h-8 rounded-lg border border-slate-200 dark:border-slate-700">
          <button onClick={() => onVote(template.id, score, 1)} title="Hot" className={`flex items-center px-2 rounded-l-lg transition-colors ${myVote === 1 ? 'text-red-500 bg-red-50 dark:bg-red-900/20' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            <Flame className="w-3.5 h-3.5" />
          </button>
          <span className={`flex items-center px-1.5 text-xs font-bold tabular-nums ${score > 0 ? 'text-red-500' : score < 0 ? 'text-sky-500' : 'text-slate-400'}`}>{score > 0 ? `+${score}` : score}°</span>
          <button onClick={() => onVote(template.id, score, -1)} title="Cold" className={`flex items-center px-2 rounded-r-lg transition-colors ${myVote === -1 ? 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            <Snowflake className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      footerRight={(
        <Link
          to={`/library/${template.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-xs font-bold rounded-lg hover:bg-brand-700 transition-all shadow-sm"
        >
          <ArrowUpRight className="w-3.5 h-3.5" /> See template details
        </Link>
      )}
    />
  );
});

export default Library;
