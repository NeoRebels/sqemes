import React, { useState } from 'react';
import { Search, X, Loader2, Image, FileText, FileSpreadsheet, File } from 'lucide-react';
import Modal from './ui/Modal';
import { SUPPORTED_MIME_TYPES, isImageType, fileTypeLabel } from '../lib/uploadTypes';
import type { WorkspaceFile } from '../types';

// SQEM-080 — pick workspace files to attach to a chat message. Only shows files
// chat can attach inline; the caller fetches + attaches the chosen ones.

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (isImageType(mimeType)) return <Image className={className} />;
  if (mimeType === 'text/csv') return <FileSpreadsheet className={className} />;
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return <FileText className={className} />;
  return <File className={className} />;
}

export function WorkspaceFilePickerModal({
  files,
  onClose,
  onAttach,
}: {
  files: WorkspaceFile[];
  onClose: () => void;
  onAttach: (selected: WorkspaceFile[]) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attaching, setAttaching] = useState(false);

  const attachable = files.filter(f => SUPPORTED_MIME_TYPES.has(f.mimeType));
  const filtered = attachable.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const handleAttach = async () => {
    const chosen = attachable.filter(f => selected.has(f.id));
    if (chosen.length === 0) return;
    setAttaching(true);
    await onAttach(chosen);
    setAttaching(false);
    onClose();
  };

  return (
    <Modal open onClose={attaching ? undefined : onClose} size="md">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Attach workspace files</h3>
          <button type="button" onClick={onClose} disabled={attaching} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-40 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 mb-3 border border-slate-200 dark:border-slate-600 rounded-xl">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files…"
            className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400"
          />
        </div>

        <div className="max-h-72 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              {attachable.length === 0 ? 'No attachable files in this workspace' : 'No files match your search'}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(f => {
                const isSel = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    className={`w-full text-left px-2.5 py-2 flex items-center gap-2.5 rounded-lg transition-colors ${isSel ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                  >
                    <input type="checkbox" checked={isSel} readOnly className="w-4 h-4 rounded accent-brand-600 pointer-events-none shrink-0" />
                    <TypeIcon mimeType={f.mimeType} className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{f.name}</p>
                      <p className="text-xs text-slate-400">{fileTypeLabel(f.mimeType)} · {fmtSize(f.sizeBytes)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={attaching}
            className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAttach}
            disabled={attaching || selected.size === 0}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
          >
            {attaching && <Loader2 className="w-4 h-4 animate-spin" />}
            {attaching ? 'Attaching…' : `Attach${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
