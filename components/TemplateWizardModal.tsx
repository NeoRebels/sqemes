// SQEM-308 — one template, from a sentence about the goal plus the brand.
//
// ⛔ **Cloud-only, and the reason is the brand.** Self-host has no brand profile in this form, so
// `pages/Templates.tsx` does not render the button there at all — it does not offer "Set up brand"
// either, because that would send an operator to a page that cannot help them.
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles, Paperclip, Upload, X, AlertCircle } from 'lucide-react';
import Modal from './ui/Modal';
import SegmentedTabs, { type SegmentedTab } from './ui/SegmentedTabs';
import { WorkspaceFilePickerModal } from './WorkspaceFilePickerModal';
import { useWorkspace, useUI, usePrompts, useData } from '../store';
import { authoringModelId } from '../lib/authoringAI';
import { generateSingleTemplate } from '../lib/wizardGeneration';
import { describeAIError } from '../lib/aiErrors';
import { getWorkspaceFileSignedUrl, uploadWorkspaceFile } from '../lib/api/files';
import sqemesIcon from '../assets/sqemes-icon.svg';
import type { Prompt, PromptKind, WorkspaceFile } from '../types';

const KINDS: readonly SegmentedTab<PromptKind>[] = [
  { value: 'prompt', label: 'Prompt' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'skill', label: 'Skill' },
];

export default function TemplateWizardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { workspace, currentUser } = useWorkspace();
  const { showToast } = useUI();
  const { addPrompt } = usePrompts();
  const { workspaceFiles, addWorkspaceFile } = useData();

  const [kind, setKind] = useState<PromptKind>('prompt');
  const [goal, setGoal] = useState('');
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // ⛔ Only reset on a *successful* close. A failed run keeps everything: the goal is the work the
  // person put in, and throwing it away to show them an error is the worst possible trade.
  const closeAndReset = () => {
    setKind('prompt'); setGoal(''); setFiles([]); setError(null);
    onClose();
  };

  const attach = (picked: WorkspaceFile[]) => {
    setFiles(prev => [...prev, ...picked.filter(p => !prev.some(f => f.id === p.id))]);
    setPicking(false);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!picked.length || !workspace) return;
    try {
      for (const f of picked) {
        const created = await uploadWorkspaceFile(workspace.id, f, []);
        addWorkspaceFile(created);
        setFiles(prev => [...prev, created]);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed — try a smaller file or a different format.', 'error');
    }
  };

  /** The attached documents' text, for the model to read. Binaries are skipped rather than failing. */
  const readAttachments = async () => {
    const out: { name: string; text: string }[] = [];
    for (const f of files) {
      try {
        const res = await fetch(await getWorkspaceFileSignedUrl(f.storagePath));
        const text = await res.text();
        if (text.trim()) out.push({ name: f.name, text: text.trim() });
      } catch { /* a file we cannot read is context we do without, not a failed run */ }
    }
    return out;
  };

  const run = async () => {
    if (!workspace?.brandProfile || !currentUser || !goal.trim()) return;
    setBusy(true); setError(null);
    try {
      const draft = await generateSingleTemplate(
        kind,
        goal.trim(),
        await readAttachments(),
        {
          brandName: workspace.brandProfile.brandName,
          whatItDoes: workspace.brandProfile.whatItDoes,
          audience: workspace.brandProfile.audience,
          tone: workspace.brandProfile.tone,
          useCase: workspace.brandProfile.useCase,
        },
        { workspaceId: workspace.id, modelId: authoringModelId(workspace) },
      );

      // The generation decides which attachments the template keeps (owner's decision, 2026-09-01):
      // an attachment may be background to understand, not context to carry. Matched by name, and
      // an unmatched name is simply dropped — the model naming a file we do not have is not a
      // reason to fail a template the person can already see.
      const keep = files.filter(f => draft.keepFiles.includes(f.name)).map(f => f.id);

      const now = new Date().toISOString();
      const created = await addPrompt({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        kind: draft.kind,
        title: draft.title,
        description: draft.description,
        tag: null,
        variables: draft.variables,
        content: draft.content,
        systemInstruction: draft.systemInstruction,
        contextFileIds: keep,
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.id,
        usageCount: 0,
        published: true,
      } as Prompt);

      if (!created) throw new Error('The template was generated but could not be saved. Try again.');
      closeAndReset();
      // Straight into the editor: the person has to see what was made, and — because the generation
      // chose the context files — which documents came along.
      navigate(`/prompts/${created.id}`);
    } catch (err) {
      setError(describeAIError(err, 'Generating the template failed.'));
    } finally {
      setBusy(false);
    }
  };

  if (picking) {
    return <WorkspaceFilePickerModal files={workspaceFiles} onClose={() => setPicking(false)} onAttach={async p => attach(p)} />;
  }

  return (
    <Modal open={open} onClose={() => !busy && closeAndReset()} size="md" className="p-6 md:p-8">
      {busy ? (
        /* ⛔ No progress bar. We do not know how long the model will take, and a bar that stops at
           90 % is a worse lie than an honest pulse. */
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <img src={sqemesIcon} alt="" className="w-14 h-14 animate-pulse" />
          <p className="mt-5 text-sm font-bold text-slate-800 dark:text-slate-100">Writing your {KINDS.find(k => k.value === kind)?.label.toLowerCase()}…</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Reading your brand{files.length ? ` and ${files.length} document${files.length === 1 ? '' : 's'}` : ''}</p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Template Wizard</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Describe what you need. Your brand fills in the rest.</p>
            </div>
          </div>

          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What do you want to build?</label>
          <SegmentedTabs<PromptKind> tabs={KINDS} value={kind} onChange={setKind} className="mb-5" />

          <label htmlFor="wizard-goal" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
            What do you want to achieve with your template?
          </label>
          <textarea
            id="wizard-goal"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            rows={4}
            placeholder="e.g. Answer support emails about delivery delays, in our tone, without promising a date we cannot keep."
            className="w-full p-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />

          <div className="flex items-center gap-2 mt-4">
            <button type="button" onClick={() => setPicking(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <Paperclip className="w-3.5 h-3.5" /> Attach a file
            </button>
            <button type="button" onClick={() => uploadRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
            <input ref={uploadRef} type="file" multiple onChange={onUpload} className="hidden" />
          </div>

          {/* ⚠️ Said plainly, because the two roles look identical: what is attached here is material
              to read. Whether a document also belongs *on* the template is decided by the generation,
              and the editor is where it can be corrected. */}
          {files.length > 0 && (
            <div className="mt-3">
              <div className="flex flex-wrap gap-1.5">
                {files.map(f => (
                  <span key={f.id} className="inline-flex items-center gap-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-lg px-2 py-1 text-slate-600 dark:text-slate-300">
                    {f.name}
                    <button type="button" onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} className="text-slate-400 hover:text-red-500" aria-label={`Remove ${f.name}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-2xs text-slate-400 dark:text-slate-500 mt-2">Read while writing your template. Which of them stay attached is decided as it is written — you can change that afterwards.</p>
            </div>
          )}

          {/* The input above is deliberately still here. */}
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="flex gap-2 mt-6">
            <button onClick={closeAndReset} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-sm font-bold transition-colors">Cancel</button>
            <button
              onClick={run}
              disabled={!goal.trim()}
              className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" /> Create template
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
