import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Upload, Search, Image, FileText, FileSpreadsheet, File,
  Trash2, Loader2, ExternalLink, ChevronDown, ArrowUpDown, Pencil,
} from 'lucide-react';
import Card from '../components/ui/Card';
import SearchInput from '../components/ui/SearchInput';
import SegmentedTabs, { SegmentedTab } from '../components/ui/SegmentedTabs';
import EmptyState from '../components/ui/EmptyState';
import TagFilter from '../components/ui/TagFilter';
import TagEditor from '../components/ui/TagEditor';
import BulkActionBar from '../components/ui/BulkActionBar';
import Modal from '../components/ui/Modal';
import { useData, useWorkspace, useUI, usePrompts } from '../store';
import { uploadWorkspaceFile, updateWorkspaceFile, getWorkspaceFileSignedUrl } from '../lib/api/files';
import { collectWorkspaceTags } from '../lib/workspaceTags';
import { FILE_ACCEPT_STRING, isImageType, fileTypeLabel, MAX_FILE_SIZE_MB } from '../lib/uploadTypes';
import type { WorkspaceFile } from '../types';

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

type TypeFilter = 'all' | 'images' | 'documents';
type SortKey = 'newest' | 'name' | 'largest' | 'mostused';

// ---- FileRow ----

// Cache signed thumbnail URLs by storage path so rows don't refetch on every
// re-render / re-sort. Thumbnails are cached for the session, so they use a longer 1h expiry
// (SQEM-117) — the default 5-min window is for immediate opens/downloads.
const THUMB_SIGNED_URL_TTL = 3600;
const thumbUrlCache = new Map<string, string>();

const FileRow = ({
  file,
  usageCount,
  workspaceTags,
  selected,
  onToggleSelect,
  onDelete,
}: {
  file: WorkspaceFile;
  usageCount: number;
  workspaceTags: string[];
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const { showToast } = useUI();
  const { patchWorkspaceFile } = useData();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tags, setTags] = useState<string[]>(file.tags);
  const [opening, setOpening] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);

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
    setTags(next);
    try {
      await updateWorkspaceFile(file.id, { tags: next });
    } catch {
      setTags(tags);
      showToast('Failed to update tags', 'error');
    }
  }, [tags, file.id, showToast]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    try {
      await updateWorkspaceFile(file.id, { tags: next });
    } catch {
      setTags(tags);
      showToast('Failed to update tags', 'error');
    }
  }, [tags, file.id, showToast]);

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
    <Card className={`group p-3 sm:p-4 flex items-start gap-3 transition-shadow ${selected ? 'ring-2 ring-brand-500' : ''}`}>
      {/* Icon / thumbnail + selection checkbox */}
      <div className="relative w-10 h-10 shrink-0">
        {isImage && thumbUrl ? (
          <button
            onClick={handleOpen}
            className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-brand-300 dark:hover:ring-brand-500 transition-all"
            title="Preview image"
          >
            <img src={thumbUrl} alt={file.name} loading="lazy" className="w-10 h-10 object-cover" />
          </button>
        ) : (
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-700">
            <FileIcon mimeType={file.mimeType} className="w-5 h-5 text-brand-500" />
          </div>
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(file.id)}
          onClick={e => e.stopPropagation()}
          aria-label={`Select ${file.name}`}
          className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded accent-brand-600 cursor-pointer bg-white dark:bg-slate-800 shadow transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
        />
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
            className="w-full text-sm font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-700 border border-brand-300 focus:border-brand-500 rounded-lg px-2 py-0.5 outline-none"
          />
        ) : (
          <div className="flex items-center gap-1.5 group/name">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={file.name}>
              {file.name}
            </p>
            <button
              onClick={() => { setNameVal(file.name); setEditingName(true); }}
              className="opacity-0 group-hover/name:opacity-100 transition-opacity text-slate-300 hover:text-brand-500 shrink-0"
              title="Rename file"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Meta line */}
        <div className="flex items-center gap-x-2 gap-y-1 mt-1 flex-wrap text-xs text-slate-400">
          <span className="font-medium uppercase tracking-wide">{fileTypeLabel(file.mimeType)}</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span>{formatBytes(file.sizeBytes)}</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span>{formatDate(file.createdAt)}</span>
          <span
            className={`px-1.5 py-0.5 rounded-md font-semibold ${
              usageCount > 0
                ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
            }`}
            title={usageCount > 0 ? `Referenced by ${usageCount} template${usageCount === 1 ? '' : 's'}` : 'Not used by any template'}
          >
            {usageCount > 0 ? `Used in ${usageCount}` : 'Unused'}
          </span>

          {(tags.length > 0 || availableTags.length > 0) && (
            <span className="text-slate-300 dark:text-slate-600">·</span>
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
              className="text-xs font-bold text-red-600 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleOpen}
              disabled={opening}
              className="p-1.5 text-slate-300 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors disabled:opacity-50"
              title="Open in new tab"
            >
              {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="Delete file"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </Card>
  );
};

// ---- Main page ----

export default function Files() {
  const { workspaceFiles, addWorkspaceFile, removeWorkspaceFile, removeWorkspaceFiles } = useData();
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
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared workspace tag vocabulary (templates + files) — managed in one place.
  const allTags = useMemo(
    () => collectWorkspaceTags(prompts, workspaceFiles),
    [prompts, workspaceFiles]
  );

  // "Used in N templates" — count prompts referencing each file (client-side).
  const usageByFile = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prompts) {
      for (const fid of p.contextFileIds || []) {
        map.set(fid, (map.get(fid) || 0) + 1);
      }
    }
    return map;
  }, [prompts]);

  const filtered = workspaceFiles.filter(f => {
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase())
      || f.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchesType =
      typeFilter === 'all'
      || (typeFilter === 'images' && isImageType(f.mimeType))
      || (typeFilter === 'documents' && !isImageType(f.mimeType));
    const matchesTag = selectedTag ? f.tags.includes(selectedTag) : true;
    return matchesSearch && matchesType && matchesTag;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name);
      case 'largest': return b.sizeBytes - a.sizeBytes;
      case 'mostused': return (usageByFile.get(b.id) || 0) - (usageByFile.get(a.id) || 0);
      case 'newest':
      default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  // --- Bulk selection ---
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

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    await removeWorkspaceFiles(Array.from(selectedIds));
    setBulkDeleting(false);
    setBulkConfirm(false);
    setSelectedIds(new Set());
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
    { value: 'images', label: 'Images' },
    { value: 'documents', label: 'Documents' },
  ];

  return (
    <div
      className={`p-4 md:p-8 pb-16 md:pb-20 max-w-7xl mx-auto transition-colors ${dragOver ? 'bg-brand-50/60 dark:bg-brand-900/10' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 md:mb-10 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Files</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Upload files to use as context in your templates · Max {MAX_FILE_SIZE_MB} MB per file
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none"
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
      </div>

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
        <div className="relative flex items-center self-stretch rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
          <ArrowUpDown className="absolute left-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            aria-label="Sort files"
            className="pl-8 pr-7 h-full text-sm font-medium outline-none appearance-none bg-transparent cursor-pointer text-slate-600 dark:text-slate-300"
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="largest">Largest</option>
            <option value="mostused">Most used</option>
          </select>
          <ChevronDown className="absolute right-2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Drag-and-drop hint */}
      {dragOver && (
        <div className="border-2 border-dashed border-brand-400 rounded-2xl p-12 text-center mb-6">
          <Upload className="w-10 h-10 text-brand-400 mx-auto mb-3" />
          <p className="text-brand-600 dark:text-brand-400 font-semibold">Drop files to upload</p>
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
        />
      )}

      {/* List */}
      {filtered.length === 0 ? (
        workspaceFiles.length === 0 ? (
          <EmptyState
            icon={<Upload className="w-8 h-8 text-brand-400" />}
            iconWrapClassName="bg-brand-50 dark:bg-brand-900/20"
            title="No files yet"
            description="Upload PDFs, documents, and images to use as context in your templates."
            action={
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-brand-200 dark:shadow-none"
              >
                <Upload className="w-4 h-4" />
                Upload your first file
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<Search className="w-8 h-8 text-slate-300 dark:text-slate-500" />}
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
              usageCount={usageByFile.get(file.id) || 0}
              workspaceTags={workspace.tags}
              selected={selectedIds.has(file.id)}
              onToggleSelect={toggleSelect}
              onDelete={removeWorkspaceFile}
            />
          ))}
        </div>
      )}

      <Modal open={bulkConfirm} onClose={() => !bulkDeleting && setBulkConfirm(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
          Delete {selectedIds.size} file{selectedIds.size === 1 ? '' : 's'}?
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          This permanently removes the selected file{selectedIds.size === 1 ? '' : 's'}. This action cannot be undone.
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
}
