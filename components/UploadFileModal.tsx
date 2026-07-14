import React, { useState, useRef, useCallback } from 'react';
import { Upload, Loader2, X } from 'lucide-react';
import Modal from './ui/Modal';
import { uploadWorkspaceFile } from '../lib/api/files';
import { FILE_ACCEPT_STRING, MAX_FILE_SIZE_MB } from '../lib/uploadTypes';
import { useUI } from '../store';
import type { WorkspaceFile } from '../types';

// SQEM-074 — upload a context file straight from the editor's file picker.
// Uploads via the existing workspace-file API and hands the uploaded files back
// so the caller can add them to the store and auto-attach them to the template.

export function UploadFileModal({
  workspaceId,
  onClose,
  onUploaded,
}: {
  workspaceId: string;
  onClose: () => void;
  onUploaded: (files: WorkspaceFile[]) => void;
}) {
  const { showToast } = useUI();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    setUploading(true);
    const uploaded: WorkspaceFile[] = [];
    try {
      for (const file of Array.from(fileList)) {
        uploaded.push(await uploadWorkspaceFile(workspaceId, file));
      }
      showToast(uploaded.length === 1 ? 'File uploaded' : `${uploaded.length} files uploaded`, 'success');
      onUploaded(uploaded);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }, [workspaceId, showToast, onUploaded]);

  return (
    <Modal open onClose={uploading ? undefined : onClose} size="md">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Upload context file</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors ${dragOver ? 'border-brand-400 bg-brand-50/60 dark:bg-brand-900/10' : 'border-slate-200 dark:border-slate-600'}`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
              <p className="text-sm font-medium">Uploading…</p>
            </div>
          ) : (
            <>
              <Upload className="w-10 h-10 text-brand-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Drag &amp; drop files here</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">or browse · max {MAX_FILE_SIZE_MB} MB per file</p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all"
              >
                <Upload className="w-4 h-4" /> Browse files
              </button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={FILE_ACCEPT_STRING}
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      </div>
    </Modal>
  );
}
