import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useUI, useWorkspace, useData } from '../store';
import { IS_SELF_HOSTED, MARKETPLACE_ENABLED } from '../lib/env';
import { TEMPLATE_CATEGORIES } from '../constants';
import { LibraryTemplate, TemplateCategory, PromptKind } from '../types';
import { voteListing, fetchMyVotes } from '../lib/api/library';
import { Edit, Trash2, EyeOff, ArrowRight, Flame, Snowflake, PenTool, Wand2, Layers } from 'lucide-react';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import KindBadge from '../components/ui/KindBadge';
import TemplateCard from '../components/ui/TemplateCard';
import MarketplaceAdminEntry from '../components/MarketplaceAdminEntry';
import { m as txt } from '../lib/i18n'; // SQEM-607 — `m` is a state-updater argument here
import { categoryLabel } from '../lib/labels';

const LibrarySkeleton = () => (
  <Card className="animate-pulse p-6 flex flex-col gap-3">
    <div className="flex items-start justify-between mb-1">
      <div className="h-5 w-20 bg-surface-sunken rounded-lg" />
      <div className="h-5 w-14 bg-surface-sunken rounded-lg" />
    </div>
    <div className="h-5 w-3/4 bg-surface-sunken rounded-lg" />
    <div className="h-4 w-full bg-surface-sunken rounded-lg" />
    <div className="h-4 w-5/6 bg-surface-sunken rounded-lg" />
    <div className="flex gap-2 mt-1">
      <div className="h-4 w-12 bg-surface-sunken rounded-lg" />
      <div className="h-4 w-16 bg-surface-sunken rounded-lg" />
    </div>
    <div className="mt-auto pt-3 border-t border-line flex gap-2">
      <div className="h-9 flex-1 bg-surface-sunken rounded-xl" />
      <div className="h-9 w-9 bg-surface-sunken rounded-xl" />
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
    // SQEM-189 — self-host now votes too (via an opaque voter key → same Cloud aggregate).
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
      showToast(e instanceof Error ? e.message : txt.mk_vote_failed(), 'error');
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
      {/* SQEM-182 — Cloud-admin moderation + publishers, in a self-contained overlay (stubbed to null
          on self-host, so no admin surface ships there). */}
      <PageHeader
        title={txt.mk_title()}
        subtitle={txt.mk_subtitle()}
        actions={<MarketplaceAdminEntry />}
      />

      {/* Search + Kind filter — mirrors the Templates / Files bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={txt.pb_search()}
        />
        <SegmentedTabs<'all' | PromptKind>
          value={activeKind}
          onChange={setActiveKind}
          className="self-stretch"
          tabs={[
            { value: 'all', label: txt.pb_tab_all() },
            { value: 'prompt', label: txt.pb_tab_prompts(), icon: <PenTool className="w-3 h-3" /> },
            { value: 'skill', label: txt.pb_tab_skills(), icon: <Wand2 className="w-3 h-3" /> },
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
                ? 'bg-accent-strong text-white border-accent shadow-sm'
                : 'bg-surface-raised text-ink-muted border-line-strong hover:border-ink-subtle'
            }`}
          >
            {/* SQEM-607 — 'All' and the category values stay the filter's keys; only the label is translated. */}
            {cat === 'All' ? txt.pb_tab_all() : categoryLabel(cat)}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <LibrarySkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-surface-raised rounded-3xl border border-line border-dashed">
          <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8 text-ink-subtle" />
          </div>
          <h3 className="font-display text-xl font-semibold text-ink-strong">{txt.mk_none_found()}</h3>
          <p className="text-ink-muted text-sm mt-1">
            {search ? txt.mk_try_other_search() : txt.mk_none_in_category()}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(template => (
            <MarketplaceCard
              key={template.id}
              template={template}
              isAdmin={showAdmin}
              canVote={MARKETPLACE_ENABLED}
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
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">{txt.mk_delete_title()}</h3>
        <p className="text-sm text-ink-muted mb-6">{txt.mk_delete_body()}</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleteModalId(null)} className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors">{txt.pb_cancel()}</button>
          <Button variant="danger" onClick={() => handleDelete(deleteModalId!)} className="flex-1 py-2.5 text-xs shadow-lg">{txt.pb_yes_delete()}</Button>
        </div>
      </Modal>

    </div>
  );
};

const MarketplaceCard = memo(function MarketplaceCard({
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
}) {

  return (
    <TemplateCard
      topRight={isAdmin && (
        // SQEM-168 — bigger padding + gap so the hover admin buttons clear the stretched card link.
        <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1.5 reveal-on-hover transition-opacity">
          <button onClick={() => onEdit(template.id)} className="p-2.5 text-ink-subtle hover:text-accent hover:bg-accent-soft rounded-lg transition-colors bg-surface-raised/80" title={txt.mk_edit()}>
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(template.id)} className="p-2.5 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-lg transition-colors bg-surface-raised/80" title={txt.pb_delete()}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      badges={(
        <>
          <KindBadge kind={template.kind} />
          {/* SQEM-554 (e2) — neutral: colour belongs to the kind and the accent; eight
              category hues competed with C's palette. */}
          <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-surface-sunken text-ink-muted">
            {categoryLabel(template.category)}
          </span>
          {!template.published && isAdmin && (
            <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-warning-soft text-ink-strong flex items-center gap-1">
              <EyeOff className="w-3 h-3" /> {txt.mk_draft()}
            </span>
          )}
        </>
      )}
      title={template.title}
      titleHref={`/library/${template.id}`}
      description={template.description}
      footerLeft={canVote && (
        // SQEM-169 — temperature votes on the card: 🔥 hot (red) vs ❄️ cold (ice-blue); score in degrees.
        // h-8 (32px) — it sat beside a filled "See playbook details" button of that height until
        // SQEM-554 (e2) made that a quiet "Details →" link; the height stays as the widget's own.
        // SQEM-178 — hidden on self-host (voting needs a Cloud account).
        <div className="flex items-stretch h-8 rounded-lg border border-line-strong">
          <button onClick={() => onVote(template.id, score, 1)} title={txt.mk_hot()} className={`flex items-center px-2 rounded-l-lg transition-colors ${myVote === 1 ? 'text-danger bg-danger-soft' : 'text-ink-subtle hover:bg-surface-sunken'}`}>
            <Flame className="w-3.5 h-3.5" />
          </button>
          <span className={`flex items-center px-1.5 text-xs font-bold tabular-nums ${score > 0 ? 'text-danger' : score < 0 ? 'text-sky-500' : 'text-ink-subtle'}`}>{score > 0 ? `+${score}` : score}°</span>
          <button onClick={() => onVote(template.id, score, -1)} title={txt.mk_cold()} className={`flex items-center px-2 rounded-r-lg transition-colors ${myVote === -1 ? 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'text-ink-subtle hover:bg-surface-sunken'}`}>
            <Snowflake className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      footerRight={(
        // SQEM-554 (e2) — a quiet link, not a filled button on every card (the same move
        // SQEM-330 made on the playbook cards). The title is the card's main link to the same page.
        <Link
          to={`/library/${template.id}`}
          className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
        >
          {txt.mk_details()} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
    />
  );
});

export default Library;
