import React, { useState } from 'react';
import { X, FileText, FileSpreadsheet, Image, Paperclip, Upload } from 'lucide-react';
import type { WorkspaceFile } from '../types';
import PickerDropdown from './ui/PickerDropdown';

function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('image/')) return <Image className={className} />;
  if (mimeType === 'text/csv') return <FileSpreadsheet className={className} />;
  return <FileText className={className} />;
}

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  files: WorkspaceFile[];
  disabled?: boolean;
  onUploadClick?: () => void;
}

export function ContextFilePicker({ selectedIds, onChange, files, disabled = false, onUploadClick }: Props) {
  const [search, setSearch] = useState('');

  const selected = files.filter(f => selectedIds.includes(f.id));
  const available = files.filter(f =>
    !selectedIds.includes(f.id) &&
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  return (
    <div>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(f => (
            <span key={f.id} className="inline-flex items-center gap-1 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/50 px-2 py-1 rounded-lg text-xs font-medium max-w-full">
              <FileTypeIcon mimeType={f.mimeType} className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[140px]">{f.name}</span>
              {!disabled && (
                <button type="button" onClick={() => toggle(f.id)} className="hover:text-sky-900 dark:hover:text-sky-200 ml-0.5 shrink-0">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <PickerDropdown
        disabled={disabled}
        triggerIcon={<Paperclip className="w-3.5 h-3.5 shrink-0" />}
        triggerLabel={files.length === 0 ? 'No files in workspace' : 'Attach context files...'}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search files..."
        footer={onUploadClick ? (close) => (
          <button
            type="button"
            onClick={() => { close(); onUploadClick(); }}
            className="w-full text-left px-3 py-2 flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold">Upload context file</span>
          </button>
        ) : undefined}
      >
        {() => (
          available.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              {files.length === 0 ? 'No files in workspace' : search ? 'No files match your search' : 'All files already attached'}
            </div>
          ) : (
            available.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => { toggle(f.id); setSearch(''); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <FileTypeIcon mimeType={f.mimeType} className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{f.name}</p>
                  <p className="text-xs text-slate-400">{(f.sizeBytes / 1024).toFixed(0)} KB</p>
                </div>
              </button>
            ))
          )
        )}
      </PickerDropdown>
    </div>
  );
}
