import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Link } from 'react-router';
import {
  Upload, Search, Image, FileText, FileSpreadsheet, File,
  Trash2, Loader2, ExternalLink, ChevronDown, ArrowUpDown, Pencil,
  Wand2, PenTool, Lock, Link2,
} from 'lucide-react';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs, { SegmentedTab } from '../components/ui/SegmentedTabs';
import EmptyState from '../components/ui/EmptyState';
import TagFilter from '../components/ui/TagFilter';
import SelectFilter from '../components/ui/SelectFilter';
import TagEditor from '../components/ui/TagEditor';
import BulkActionBar from '../components/ui/BulkActionBar';
import Modal from '../components/ui/Modal';
import { useData, useWorkspace, useUI, usePrompts } from '../store';
import { uploadWorkspaceFile, updateWorkspaceFile, getWorkspaceFileSignedUrl, getWorkspaceFileUsage } from '../lib/api/files';
import { planTagChange, tagChangeSummary, tagsOnSelection } from '../lib/fileTags';
import { collectWorkspaceTags } from '../lib/workspaceTags';
import { FILE_ACCEPT_STRING, isImageType, isMediaFile, fileTypeLabel, MAX_FILE_SIZE_MB } from '../lib/uploadTypes';
import type { WorkspaceFile } from '../types';
import Checkbox from '../components/ui/Checkbox';

// ---- helpers ----

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (isImageType(mimeType)) return <Image className={className} />;
  if (mimeType === 'text/csv') return <FileSpreadsheet className={className} />;
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return <FileText className={className} />;
  return <File className={className} />;
}

type TypeFilter = 'all' | 'media' | 'documents'; // SQEM-562 — "Media" = images, video, audio
type SortKey = 'newest' | 'name' | 'largest' | 'mostused' | 'leastused';

// A template that references a file — surfaced in the usage popover (SQEM-175).
type FileUsage = { id: string; title: string; kind: string };

function KindIcon({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'skill') return <Wand2 className={className} />;
  return <PenTool className={className} />;
}

// ---- FileRow ----

// Cache signed thumbnail URLs by storage path so rows don't refetch on every
// re-render / re-sort. Thumbnails are cached for the session, so they use a longer 1h expiry
// (SQEM-117) — the default 5-min window is for immediate opens/downloads.
const THUMB_SIGNED_URL_TTL = 3600;
const thumbUrlCache = new Map<string, string>();

const FileRow = ({
  file,
  usedBy,
  totalUsage,
  workspaceTags,
  selected,
  onToggleSelect,
  onDelete,
}: {
  file: WorkspaceFile;
  usedBy: FileUsage[];
  /** SQEM-234 — total referencing templates incl. ones this viewer may not see. */
  totalUsage: number;
  workspaceTags: string[];
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const { showToast } = useUI();
  const { patchWorkspaceFile } = useData();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // SQEM-253 — the store is the single source of truth for tags, patched optimistically the way the
  // rename below already does. It used to be local state seeded from `file.tags`, which a bulk tag
  // change could not reach: the row does not remount, so `useState`'s initial value would keep
  // showing the old tags and the action would look like it had done nothing.
  const tags = file.tags;
  const [opening, setOpening] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);
  const [showUsage, setShowUsage] = useState(false);
  const usageRef = useRef<HTMLDivElement>(null);
  // SQEM-234 — the label must reflect EVERY referencing template, not just the visible ones.
  // usedBy holds what this viewer may see; the remainder is reported as a count without names.
  const usageCount = totalUsage;
  const restrictedCount = Math.max(0, totalUsage - usedBy.length);

  // Close the usage popover on outside-click (SQEM-175).
  useEffect(() => {
    if (!showUsage) return;
    const onDown = (e: MouseEvent) => {
      if (usageRef.current && !usageRef.current.contains(e.target as Node)) setShowUsage(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showUsage]);

  // Tags can only be chosen from the workspace tag registry (managed in
  // Settings) — same source the template editor uses. No free-text tags.
  const availableTags = workspaceTags.filter(t => !tags.includes(t));

  const isImage = isImageType(file.mimeType);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => thumbUrlCache.get(file.storagePath) ?? null);

  // Lazily fetch a signed URL for image files to show a real thumbnail.
  useEffect(() => {
    if (!isImage || thumbUrl) return;
    let cancelled = false;
    getWorkspaceFileSignedUrl(file.storagePath, THUMB_SIGNED_URL_TTL)
      .then(url => {
        thumbUrlCache.set(file.storagePath, url);
        if (!cancelled) setThumbUrl(url);
      })
      .catch(() => { /* fall back to the type icon */ });
    return () => { cancelled = true; };
  }, [isImage, file.storagePath, thumbUrl]);

  const addTag = useCallback(async (tag: string) => {
    if (!tag || tags.includes(tag)) return;
    const next = [...tags, tag];
    patchWorkspaceFile(file.id, { tags: next }); // optimistic
    try {
      await updateWorkspaceFile(file.id, { tags: next });
    } catch {
      patchWorkspaceFile(file.id, { tags }); // revert
      showToast('Failed to update tags', 'error');
    }
  }, [tags, file.id, patchWorkspaceFile, showToast]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    const next = tags.filter(t => t !== tag);
    patchWorkspaceFile(file.id, { tags: next }); // optimistic
    try {
      await updateWorkspaceFile(file.id, { tags: next });
    } catch {
      patchWorkspaceFile(file.id, { tags }); // revert
      showToast('Failed to update tags', 'error');
    }
  }, [tags, file.id, patchWorkspaceFile, showToast]);

  const handleOpen = useCallback(async () => {
    setOpening(true);
    try {
      const url = await getWorkspaceFileSignedUrl(file.storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      showToast('Could not open file', 'error');
    } finally {
      setOpening(false);
    }
  }, [file.storagePath, showToast]);

  const commitRename = useCallback(async () => {
    setEditingName(false);
    const next = nameVal.trim();
    if (!next || next === file.name) { setNameVal(file.name); return; }
    const prev = file.name;
    patchWorkspaceFile(file.id, { name: next }); // optimistic
    try {
      await updateWorkspaceFile(file.id, { name: next });
    } catch {
      patchWorkspaceFile(file.id, { name: prev }); // revert
      setNameVal(prev);
      showToast('Failed to rename file', 'error');
    }
  }, [nameVal, file.id, file.name, patchWorkspaceFile, showToast]);

  return (
    <Card className={`group p-3 sm:p-4 flex items-start gap-3 transition-shadow ${selected ? 'ring-2 ring-accent' : ''}`}>
      {/* Icon / thumbnail + selection checkbox */}
      <div className="relative w-10 h-10 shrink-0">
        {isImage && thumbUrl ? (
          <button
            onClick={handleOpen}
            className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-line-strong hover:ring-accent/50 transition-all"
            title="Preview image"
          >
            <img src={thumbUrl} alt={file.name} loading="lazy" className="w-10 h-10 object-cover" />
          </button>
        ) : (
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface-sunken">
            <FileIcon mimeType={file.mimeType} className="w-5 h-5 text-accent" />
          </div>
        )}
        {/* SQEM-294 — the wrapper carries the click guard the raw input used to have. Without it a
            tick would bubble to the card and open the file, which is the opposite of selecting it.
            The primitive takes no `onClick` on purpose: a checkbox that swallows clicks is a
            behaviour of *this* list, not of every checkbox. */}
        {/* SQEM-540 — a label with padding, so the 16 px box has a 24 px target (as on the playbook cards). */}
        <label
          onClick={e => e.stopPropagation()}
          className={`absolute -top-2.5 -left-2.5 p-1 cursor-pointer transition-opacity ${selected ? 'opacity-100' : 'reveal-on-hover'}`}
        >
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(file.id)}
            align="center"
            aria-label={`Select ${file.name}`}
            className="bg-surface-raised shadow"
          />
        </label>
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        {editingName ? (
          <input
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setEditingName(false); setNameVal(file.name); }
            }}
            onBlur={commitRename}
            autoFocus
            className="w-full text-sm font-semibold text-ink-strong bg-surface-field border border-accent/40 focus:border-accent rounded-lg px-2 py-0.5 outline-none"
          />
        ) : (
          <div className="flex items-center gap-1.5 group/name">
            <p className="text-sm font-semibold text-ink-strong truncate" title={file.name}>
              {file.name}
            </p>
            <button
              onClick={() => { setNameVal(file.name); setEditingName(true); }}
              className="relative hit-24 reveal-on-hover transition-opacity text-ink-subtle hover:text-accent shrink-0"
              title="Rename file"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Meta line */}
        <div className="flex items-center gap-x-2 gap-y-1 mt-1 flex-wrap text-xs text-ink-subtle">
          <span className="font-medium uppercase tracking-wide">{fileTypeLabel(file.mimeType, file.name)}</span>
          <span className="text-ink-subtle">·</span>
          <span>{formatBytes(file.sizeBytes)}</span>
          <span className="text-ink-subtle">·</span>
          <span>{formatDate(file.createdAt)}</span>
          <span className="relative inline-flex" ref={usageRef}>
            <button
              type="button"
              onClick={() => usageCount > 0 && setShowUsage(v => !v)}
              className={`px-1.5 py-0.5 rounded-md font-semibold transition-colors ${
                usageCount > 0
                  ? 'bg-accent-soft text-accent hover:bg-accent/15 cursor-pointer'
                  : 'bg-surface-sunken text-ink-subtle cursor-default'
              }`}
              title={usageCount > 0 ? `Referenced by ${usageCount} playbook${usageCount === 1 ? '' : 's'} — click to see which` : 'Not used by any playbook'}
            >
              {usageCount > 0 ? `Used in ${usageCount}` : 'Unused'}
            </button>
            {showUsage && usageCount > 0 && (
              <div className="absolute left-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto bg-surface-raised rounded-xl shadow-xl border border-line py-1 animate-scale-up origin-top-left">
                <div className="px-3 py-1.5 border-b border-line">
                  <p className="text-2xs font-bold text-ink-subtle uppercase tracking-wider">
                    Used in {usageCount} playbook{usageCount === 1 ? '' : 's'}
                  </p>
                </div>
                {usedBy.map(t => (
                  <Link
                    key={t.id}
                    // SQEM-313 — the editor, not the `/playbooks/:id` shim (which lands in Chat).
                    // Someone opening "used in N templates" wants to see *where* the file hangs — and
                    // that is the context-file list in the editor, the only place they can remove it.
                    to={`/playbooks/${t.id}/edit`}
                    onClick={() => setShowUsage(false)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-surface-sunken hover:text-accent transition-colors"
                  >
                    <KindIcon kind={t.kind} className="w-3.5 h-3.5 shrink-0 text-ink-subtle" />
                    <span className="truncate font-medium">{t.title}</span>
                  </Link>
                ))}
                {/* SQEM-234 — templates this viewer may not see: counted, never named. Without this
                    line the file read as "Unused" and was the first thing anyone would delete. */}
                {restrictedCount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-subtle">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate italic">
                      {restrictedCount} restricted playbook{restrictedCount === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </span>

          {(tags.length > 0 || availableTags.length > 0) && (
            <span className="text-ink-subtle">·</span>
          )}
          <TagEditor tags={tags} available={availableTags} onAdd={addTag} onRemove={handleRemoveTag} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {confirmDelete ? (
          <>
            <button
              onClick={() => onDelete(file.id)}
              className="text-xs font-bold text-danger hover:opacity-80 px-2 py-1 rounded-lg hover:bg-danger-soft transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-ink-muted hover:text-ink-strong px-2 py-1 rounded-lg hover:bg-surface-sunken transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleOpen}
              disabled={opening}
              className="p-1.5 text-ink-subtle hover:text-accent hover:bg-accent-soft rounded-lg transition-colors disabled:opacity-50"
              title="Open in new tab"
            >
              {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            </button>
            {/* SQEM-234 — a file a template still needs cannot be deleted. The database refuses it
                either way; disabling here means the user learns why on hover instead of collecting
                an error afterwards.

                The title sits on the WRAPPER, not the button: a disabled button receives no pointer
                events in several browsers, so a tooltip on it never appears — and a tooltip that
                explains a disabled control is the whole point of disabling it visibly. */}
            <span
              title={
                usageCount > 0
                  ? `Cannot be deleted — this file is in use by ${usageCount} playbook${usageCount === 1 ? '' : 's'}`
                  : 'Delete file'
              }
              className="inline-flex"
            >
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={usageCount > 0}
                className={`p-1.5 rounded-lg transition-colors ${
                  usageCount > 0
                    ? 'text-ink-subtle opacity-40 cursor-not-allowed'
                    : 'text-ink-subtle hover:text-danger hover:bg-danger-soft'
                }`}
                aria-label={usageCount > 0 ? 'Delete file (unavailable — file is in use)' : 'Delete file'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </span>
          </>
        )}
      </div>
    </Card>
  );
};

// ---- Main page ----

export default function Files() {
  const { workspaceFiles, addWorkspaceFile, patchWorkspaceFile, removeWorkspaceFile, removeWorkspaceFiles } = useData();
  const { workspace } = useWorkspace();
  const { showToast } = useUI();
  const { prompts } = usePrompts();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('newest');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [usedIn, setUsedIn] = useState<string | null>(null); // SQEM-254
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [tagBusy, setTagBusy] = useState(false); // SQEM-253
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared workspace tag vocabulary (templates + files) — managed in one place.
  const allTags = useMemo(
    () => collectWorkspaceTags(prompts, workspaceFiles),
    [prompts, workspaceFiles]
  );

  // Map each file to the templates referencing it via contextFileIds (client-side).
  // Drives both the "Used in N" popover and the usage-based sorts (SQEM-175).
  const templatesByFile = useMemo(() => {
    const map = new Map<string, FileUsage[]>();
    for (const p of prompts) {
      for (const fid of p.contextFileIds || []) {
        const list = map.get(fid) || [];
        list.push({ id: p.id, title: p.title, kind: p.kind });
        map.set(fid, list);
      }
    }
    return map;
  }, [prompts]);

  // SQEM-234 — the true count, including templates this viewer may not see. templatesByFile above is
  // built from the client store and therefore only knows the visible ones; a file attached to
  // someone else's restricted template counted zero there and was labelled "Unused" — the one label
  // that invites deleting it. Falls back to the visible count while the request is in flight.
  const [totalUsageById, setTotalUsageById] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!workspace.id) return;
    let cancelled = false;
    getWorkspaceFileUsage(workspace.id)
      .then(map => { if (!cancelled) setTotalUsageById(map); })
      .catch(() => { /* keep the visible-only count rather than showing nothing */ });
    return () => { cancelled = true; };
  }, [workspace.id, workspaceFiles.length, prompts]);

  const usageCountOf = useCallback(
    (id: string) => totalUsageById.get(id) ?? templatesByFile.get(id)?.length ?? 0,
    [totalUsageById, templatesByFile],
  );

  // SQEM-254 — the folder view's replacement. Path grouping claimed an owner a file may not have
  // (one file can hang on several templates); "used in" says the same thing truthfully, and as a
  // FILTER rather than a grouping, so no file is listed twice.
  //
  // Scoped to templates this viewer can see — `templatesByFile` is built from the RLS-filtered
  // prompt list. You cannot filter by a template you are not allowed to know about, which is the
  // right answer rather than a limitation (the *count* on each row still includes the hidden ones,
  // SQEM-234).
  const UNUSED = '__unused__';
  const usageOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const list of templatesByFile.values()) for (const t of list) byId.set(t.id, t.title);
    return [
      ...[...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
      { value: UNUSED, label: 'Not used yet' },
    ];
  }, [templatesByFile]);

  const filtered = workspaceFiles.filter(f => {
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase())
      || f.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchesType =
      typeFilter === 'all'
      || (typeFilter === 'media' && isMediaFile(f.name, f.mimeType))
      || (typeFilter === 'documents' && !isMediaFile(f.name, f.mimeType));
    const matchesTag = selectedTag ? f.tags.includes(selectedTag) : true;
    const usedByHere = templatesByFile.get(f.id) || [];
    const matchesUsage = !usedIn
      || (usedIn === UNUSED ? usageCountOf(f.id) === 0 : usedByHere.some(t => t.id === usedIn));
    return matchesSearch && matchesType && matchesTag && matchesUsage;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name);
      case 'largest': return b.sizeBytes - a.sizeBytes;
      case 'mostused': return usageCountOf(b.id) - usageCountOf(a.id);
      case 'leastused': return usageCountOf(a.id) - usageCountOf(b.id);
      case 'newest':
      default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  // --- Bulk selection ---
  // Deliberately over the whole sorted list, not only the expanded folders: "select all" means the
  // files the filters left, and collapsing a folder is a way of looking, not a way of filtering.
  const visibleIds = sorted.map(f => f.id);
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

  // SQEM-234 — files a template still needs are skipped, not attempted. The database refuses them
  // anyway; without this the bulk delete would report "deleted 3 of 7 — 4 failed" and leave the user
  // guessing which four and why. Selecting only in-use files is a no-op with an explanation.
  const selectedInUse = Array.from(selectedIds).filter(id => usageCountOf(id) > 0);
  const selectedDeletable = Array.from(selectedIds).filter(id => usageCountOf(id) === 0);

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    if (selectedDeletable.length > 0) await removeWorkspaceFiles(selectedDeletable);
    else showToast('Nothing deleted — every selected file is still used by a playbook', 'info');
    setBulkDeleting(false);
    setBulkConfirm(false);
    setSelectedIds(new Set());
  };

  // SQEM-253 — one tag onto (or off) the whole selection.
  //
  // **The vocabulary is not extended from here.** Tags come from Settings, curated, shared with the
  // template editor (`collectWorkspaceTags`); letting a bulk action mint one would hollow out the
  // very thing that makes the list worth having. Only what already exists is offered.
  //
  // Nothing is rolled back on a partial failure: a tag that landed is not damage, and the selection
  // is kept so the retry is one click. `planTagChange` is what makes a mixed selection a non-event.
  const handleBulkTag = async (tag: string, mode: 'add' | 'remove') => {
    const plan = planTagChange(workspaceFiles, selectedIds, tag, mode);
    if (plan.length === 0) {
      const { text } = tagChangeSummary(0, 0, tag, mode);
      showToast(text, 'info');
      return;
    }
    setTagBusy(true);
    let ok = 0;
    for (const { id, tags } of plan) {
      try {
        await updateWorkspaceFile(id, { tags });
        patchWorkspaceFile(id, { tags });
        ok++;
      } catch { /* keep going — the summary names both numbers */ }
    }
    setTagBusy(false);
    const { text, ok: allGood } = tagChangeSummary(ok, plan.length, tag, mode);
    showToast(text, allGood ? 'success' : 'error');
    if (allGood) setSelectedIds(new Set());
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadWorkspaceFile(workspace.id, file);
        addWorkspaceFile(uploaded);
      }
      showToast(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [workspace.id, addWorkspaceFile, showToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const tabs: SegmentedTab<TypeFilter>[] = [
    { value: 'all', label: 'All' },
    { value: 'media', label: 'Media' },
    { value: 'documents', label: 'Documents' },
  ];

  return (
    <div
      className={`p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto transition-colors ${dragOver ? 'bg-accent-soft' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <PageHeader
        title="Files"
        subtitle={<>Upload files to use as context in your playbooks · Max {MAX_FILE_SIZE_MB} MB per file</>}
        actions={<>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-strong hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-lg"
        >
          {uploading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Upload className="w-4 h-4" />}
          {uploading ? 'Uploading…' : 'Upload file'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT_STRING}
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        </>}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search files or tags…"
          containerClassName="flex-1"
        />
        <SegmentedTabs<TypeFilter> value={typeFilter} onChange={setTypeFilter} tabs={tabs} />
        {allTags.length > 0 && (
          <TagFilter tags={allTags} value={selectedTag} onChange={setSelectedTag} />
        )}
        {usageOptions.length > 1 && (
          <SelectFilter
            icon={Link2}
            ariaLabel="Filter by the playbook using the file"
            allLabel="All files"
            options={usageOptions}
            value={usedIn}
            onChange={setUsedIn}
          />
        )}
        <div className="relative flex items-center self-stretch rounded-xl border border-line-strong bg-surface-raised shadow-sm">
          <ArrowUpDown className="absolute left-3 w-3.5 h-3.5 text-ink-subtle pointer-events-none" />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            aria-label="Sort files"
            className="pl-8 pr-7 h-full text-sm font-medium outline-none appearance-none bg-transparent cursor-pointer text-ink"
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="largest">Largest</option>
            <option value="mostused">Most used</option>
            <option value="leastused">Least used</option>
          </select>
          <ChevronDown className="absolute right-2 w-3.5 h-3.5 text-ink-subtle pointer-events-none" />
        </div>
      </div>

      {/* Drag-and-drop hint */}
      {dragOver && (
        <div className="border-2 border-dashed border-accent rounded-2xl p-12 text-center mb-6">
          <Upload className="w-10 h-10 text-accent mx-auto mb-3" />
          <p className="text-accent font-semibold">Drop files to upload</p>
        </div>
      )}

      {/* Bulk selection bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          total={visibleIds.length}
          allSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          onDelete={() => setBulkConfirm(true)}
          onClear={() => setSelectedIds(new Set())}
          noun="file"
          addableTags={allTags}
          removableTags={tagsOnSelection(workspaceFiles, selectedIds)}
          onAddTag={tag => handleBulkTag(tag, 'add')}
          onRemoveTag={tag => handleBulkTag(tag, 'remove')}
          tagBusy={tagBusy}
        />
      )}

      {/* List */}
      {filtered.length === 0 ? (
        workspaceFiles.length === 0 ? (
          <EmptyState
            icon={<Upload className="w-8 h-8" />}
            tone="brand"
            title="No files yet"
            description="Upload PDFs, documents, and images to use as context in your playbooks."
            action={
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-strong hover:opacity-90 text-white text-sm font-bold rounded-xl transition-all shadow-lg"
              >
                <Upload className="w-4 h-4" />
                Upload your first file
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<Search className="w-8 h-8" />}
            title="No files match"
            description="Try adjusting your search or filter."
          />
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {sorted.map(file => (
            <FileRow
              key={file.id}
              file={file}
              usedBy={templatesByFile.get(file.id) || []}
              totalUsage={usageCountOf(file.id)}
              workspaceTags={workspace.tags}
              selected={selectedIds.has(file.id)}
              onToggleSelect={toggleSelect}
              onDelete={removeWorkspaceFile}
            />
          ))}
        </div>
      )}

      <Modal open={bulkConfirm} onClose={() => !bulkDeleting && setBulkConfirm(false)} size="sm" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">
          Delete {selectedDeletable.length} file{selectedDeletable.length === 1 ? '' : 's'}?
        </h3>
        <p className="text-sm text-ink-muted mb-2">
          This permanently removes {selectedDeletable.length === 1 ? 'it' : 'them'}. This action cannot be undone.
        </p>
        {/* SQEM-234 — say which of the selection is being kept and why, before the click rather than
            as a failure count afterwards. Some of those templates may not be visible to this user.
            SQEM-554 (e1): the warning hue sits on the icon, the sentence stays readable (amber text on
            white misses AA). */}
        {selectedInUse.length > 0 && (
          <p className="text-sm text-ink mb-2 flex items-start gap-2">
            <Lock className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
            <span>
              {selectedInUse.length} of the selected file{selectedInUse.length === 1 ? ' is' : 's are'} still
              used by a playbook and will be kept. Detach {selectedInUse.length === 1 ? 'it' : 'them'} there first.
            </span>
          </p>
        )}
        <div className="mb-6" />
        <div className="flex gap-2">
          <button
            onClick={() => setBulkConfirm(false)}
            disabled={bulkDeleting}
            className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-danger hover:opacity-90 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
          >
            {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {bulkDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
