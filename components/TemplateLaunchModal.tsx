import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePrompts, useData } from '../store';
import { Search, X, Loader2, Upload, Trash2, FileText as FileIcon, ChevronRight, Star, PenTool, Bot, Wand2 } from 'lucide-react';
import Modal from './ui/Modal';
import SegmentedTabs from './ui/SegmentedTabs';
import KindBadge from './ui/KindBadge';
import { Prompt, PromptKind, WorkspaceFile } from '../types';
import { SUPPORTED_MIME_TYPES, ACCEPT_STRING, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES, isImageType } from '../lib/uploadTypes';
import { getWorkspaceFileSignedUrl } from '../lib/api/files';

const VAR_REGEX = /{{([^}]+)}}/g;

export interface ContextImage { mimeType: string; dataUrl: string; name: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (text: string, template: Prompt, images: ContextImage[]) => void;
  onAssistantSelect: (template: Prompt, systemInstruction: string, images: ContextImage[]) => void;
  initialTemplateId?: string | null;
}

type Step = 'pick' | 'variables';
type KindFilter = 'all' | PromptKind;

export default function TemplateLaunchModal({ isOpen, onClose, onInsert, onAssistantSelect, initialTemplateId }: Props) {
  const { prompts, toggleFavorite } = usePrompts();
  const { workspaceFiles, skills: daSkills } = useData();

  const [step, setStep] = useState<Step>('pick');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [dragActive, setDragActive] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // Extract unique variable names from content
  const templateVars = useMemo(() => {
    if (!selected) return [];
    return selected.variables ?? [];
  }, [selected]);

  const filteredPrompts = useMemo(() => {
    const q = search.toLowerCase();
    return prompts.filter(p => {
      if (!p.published && p.kind !== 'skill') return false; // hide drafts, but skills may be unpublished
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false;
      if (showFavoritesOnly && !p.isFavorite) return false;
      return p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    });
  }, [prompts, search, kindFilter, showFavoritesOnly]);

  // Auto-select if initialTemplateId provided
  useEffect(() => {
    if (!isOpen) return;
    if (initialTemplateId) {
      const t = prompts.find(p => p.id === initialTemplateId);
      if (t) {
        handleSelect(t);
        return;
      }
    }
    setStep('pick');
    setSearch('');
    setSelected(null);
    setInputs({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTemplateId]);

  useEffect(() => {
    if (isOpen && step === 'pick') searchRef.current?.focus();
  }, [isOpen, step]);

  const handleSelect = (template: Prompt) => {
    setSelected(template);
    const initial: Record<string, string> = {};
    (template.variables ?? []).forEach(v => { initial[v.name] = v.defaultValue || ''; });
    setInputs(initial);
    setStep('variables');
  };

  const isAttachmentType = (mimeType: string) => isImageType(mimeType) || mimeType === 'application/pdf';

  // Images + PDFs → base64 data-URL attachments (delivered to the model as inlineData).
  const resolveAttachmentFiles = async (fileIds: string[]): Promise<ContextImage[]> => {
    const attachFiles = workspaceFiles.filter(f => fileIds.includes(f.id) && isAttachmentType(f.mimeType));
    const results: ContextImage[] = [];
    await Promise.all(attachFiles.map(async f => {
      try {
        const url = await getWorkspaceFileSignedUrl(f.storagePath);
        const res = await fetch(url);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        results.push({ mimeType: f.mimeType, dataUrl, name: f.name });
      } catch { /* skip files that fail to load */ }
    }));
    return results;
  };

  // Text/code files → raw text blocks (fetched at use time; no extraction pipeline).
  const resolveFileBlocks = async (fileIds: string[]): Promise<string[]> => {
    const textFiles = workspaceFiles.filter(f => fileIds.includes(f.id) && !isAttachmentType(f.mimeType));
    const blocks: string[] = [];
    await Promise.all(textFiles.map(async f => {
      try {
        const url = await getWorkspaceFileSignedUrl(f.storagePath);
        const res = await fetch(url);
        const text = await res.text();
        if (text.trim()) blocks.push(`[Context: ${f.name}]\n${text.trim()}`);
      } catch { /* skip */ }
    }));
    return blocks;
  };

  // Skill bodies → blocks; each skill's context file ids are resolved alongside the template's.
  const resolveSkillBlocks = (skillIds: string[] | undefined | null): { blocks: string[]; fileIds: string[] } => {
    if (!skillIds?.length) return { blocks: [], fileIds: [] };
    // Skills may live in pr.prompts (after store unification) or da.skills (legacy) — check both
    const allSkillsById = new Map<string, Prompt>();
    [...prompts, ...daSkills].forEach(p => { if (p.kind === 'skill') allSkillsById.set(p.id, p); });
    const skills = skillIds.map(id => allSkillsById.get(id)).filter((s): s is Prompt => !!s);
    const blocks: string[] = [];
    const fileIds: string[] = [];
    for (const skill of skills) {
      if (skill.content?.trim()) blocks.push(`<skill: ${skill.title}>\n${skill.content.trim()}\n</skill>`);
      if (skill.contextFileIds?.length) fileIds.push(...skill.contextFileIds);
    }
    return { blocks, fileIds };
  };

  const resolveAndLaunch = async (template: Prompt, variableInputs: Record<string, string>) => {
    setIsResolving(true);
    try {
      if (template.kind === 'assistant') {
        const skill = resolveSkillBlocks(template.skillIds);
        const allFileIds = [...(template.contextFileIds ?? []), ...skill.fileIds];
        const fileBlocks = await resolveFileBlocks(allFileIds);
        const images = await resolveAttachmentFiles(allFileIds);
        const enrichedParts = [template.systemInstruction, ...skill.blocks, ...fileBlocks].filter(Boolean);
        onAssistantSelect(template, enrichedParts.join('\n\n'), images);
        handleClose();
        return;
      }

      const skill = resolveSkillBlocks(template.skillIds);
      const allFileIds = [...(template.contextFileIds ?? []), ...skill.fileIds];
      const parts: string[] = [...skill.blocks];
      parts.push(...await resolveFileBlocks(allFileIds));

      // Substitute variables in content
      let content = template.content ?? '';
      (template.variables ?? []).forEach(v => {
        const val = variableInputs[v.name] ?? '';
        if (v.type === 'file') {
          content = content.replace(new RegExp(`{{${v.name}}}`, 'g'), '');
        } else {
          content = content.replace(new RegExp(`{{${v.name}}}`, 'g'), val);
        }
      });

      if (content.trim()) parts.push(content.trim());

      const images = await resolveAttachmentFiles(allFileIds);
      onInsert(parts.join('\n\n'), template, images);
      handleClose();
    } finally {
      setIsResolving(false);
    }
  };

  const handleLaunch = () => {
    if (!selected) return;
    resolveAndLaunch(selected, inputs);
  };

  const handleClose = () => {
    setStep('pick');
    setSearch('');
    setSelected(null);
    setInputs({});
    setIsResolving(false);
    onClose();
  };

  const handleDrag = (e: React.DragEvent, varName: string) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(varName);
    else if (e.type === 'dragleave') setDragActive(null);
  };

  const handleDrop = (e: React.DragEvent, varName: string) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(null);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file, varName);
  };

  const processFile = (file: File, varName: string) => {
    if (file.size > MAX_FILE_SIZE_BYTES) return;
    if (!SUPPORTED_MIME_TYPES.has(file.type)) return;
    const reader = new FileReader();
    reader.onloadend = () => setInputs(prev => ({ ...prev, [varName]: reader.result as string }));
    reader.readAsDataURL(file);
  };

  return (
    <Modal open={isOpen} onClose={handleClose} size="lg" className="flex flex-col max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          {step === 'variables' && (
            <button onClick={() => setStep('pick')} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              <ChevronRight className="w-4 h-4 rotate-180" />
            </button>
          )}
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {step === 'pick' ? 'Use a template' : selected?.title}
          </h2>
        </div>
        <button onClick={handleClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {step === 'pick' ? (
        <>
          {/* Search + Kind filter */}
          <div className="px-4 pt-3 pb-2 space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates..."
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <SegmentedTabs<KindFilter>
                value={kindFilter}
                onChange={setKindFilter}
                tabs={[
                  { value: 'all', label: 'All' },
                  { value: 'prompt', label: 'Prompts', icon: <PenTool className="w-3 h-3" /> },
                  { value: 'assistant', label: 'Assistants', icon: <Bot className="w-3 h-3" /> },
                  { value: 'skill', label: 'Skills', icon: <Wand2 className="w-3 h-3" /> },
                ]}
              />
              <button
                onClick={() => setShowFavoritesOnly(v => !v)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${showFavoritesOnly ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
              >
                <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                Favorites
              </button>
            </div>
          </div>

          {/* Template list */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {filteredPrompts.length === 0 ? (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500 text-sm">
                {showFavoritesOnly ? 'No favourite templates yet' : 'No templates found'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredPrompts.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all group"
                  >
                    <button
                      onClick={() => handleSelect(t)}
                      className="flex-1 min-w-0 text-left pl-4 pr-2 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <KindBadge kind={t.kind} />
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{t.title}</span>
                        </div>
                        {t.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 ml-0.5">{t.description}</p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 shrink-0 transition-colors" />
                    </button>
                    <button
                      onClick={() => toggleFavorite(t)}
                      className="p-2 mr-2 text-slate-300 hover:text-amber-400 hover:scale-110 transition-all shrink-0"
                      title={t.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                    >
                      <Star className={`w-4 h-4 ${t.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Variable form / confirm step */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {selected?.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{selected.description}</p>
            )}
            {templateVars.length === 0 && selected?.kind !== 'assistant' && (
              <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 px-4 py-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">No inputs required — the template will be inserted into the chat as-is.</p>
              </div>
            )}
            {selected?.kind === 'assistant' && (
              <div className="rounded-xl border border-violet-100 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-900/10 px-4 py-3">
                <p className="text-xs text-violet-700 dark:text-violet-300 font-semibold mb-0.5">Assistant template</p>
                <p className="text-xs text-violet-600 dark:text-violet-400">Selecting this will apply the assistant's system instruction to your chat session — no text will be inserted into the input.</p>
              </div>
            )}
            {templateVars.map(v => (
              <div key={v.id}>
                <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{v.label}</label>
                {v.type === 'textarea' ? (
                  <textarea
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all bg-white dark:bg-slate-700 placeholder:text-slate-400"
                    rows={4}
                    value={inputs[v.name] ?? ''}
                    onChange={e => setInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                  />
                ) : v.type === 'select' ? (
                  <select
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all bg-white dark:bg-slate-700 appearance-none"
                    value={inputs[v.name] ?? ''}
                    onChange={e => setInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                  >
                    <option value="">Select an option</option>
                    {v.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : v.type === 'file' ? (
                  <div
                    className={`w-full relative border-2 border-dashed rounded-xl transition-all ${dragActive === v.name ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700'}`}
                    onDragEnter={e => handleDrag(e, v.name)}
                    onDragLeave={e => handleDrag(e, v.name)}
                    onDragOver={e => handleDrag(e, v.name)}
                    onDrop={e => handleDrop(e, v.name)}
                  >
                    {inputs[v.name] ? (
                      <div className="p-3 flex items-center gap-3">
                        <div className="w-9 h-9 bg-white dark:bg-slate-600 rounded-lg border border-slate-200 dark:border-slate-500 flex items-center justify-center shrink-0 overflow-hidden">
                          {inputs[v.name].startsWith('data:image')
                            ? <img src={inputs[v.name]} alt="Preview" className="w-full h-full object-cover" />
                            : <FileIcon className="w-4 h-4 text-slate-400" />}
                        </div>
                        <p className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">File uploaded</p>
                        <button onClick={() => setInputs(prev => ({ ...prev, [v.name]: '' }))} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="p-6 text-center">
                        <Upload className="w-5 h-5 text-brand-500 mx-auto mb-2" />
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Click or drag file</p>
                        <p className="text-xs text-slate-400 mt-0.5">Images, PDF, text · max {MAX_FILE_SIZE_MB} MB</p>
                        <input
                          type="file"
                          accept={ACCEPT_STRING}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f, v.name); }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all bg-white dark:bg-slate-700 placeholder:text-slate-400"
                    value={inputs[v.name] ?? ''}
                    onChange={e => setInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                    placeholder={v.defaultValue || ''}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-2 shrink-0">
            <button onClick={() => setStep('pick')} className="flex-1 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
              Back
            </button>
            <button
              onClick={handleLaunch}
              disabled={isResolving}
              className="flex-1 py-2.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              {isResolving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
                : selected?.kind === 'assistant' ? 'Apply assistant' : 'Insert into chat'
              }
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
