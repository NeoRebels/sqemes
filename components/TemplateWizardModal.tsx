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
import { authoringModelId, hasAuthoringAlternatives } from '../lib/authoringAI';
import { generateSingleTemplate, pickHelpfulFiles } from '../lib/wizardGeneration';
import { classifyUpload, readFileAsText, readFileAsBase64, resolveVisibleFiles, generatedFileName } from '../lib/wizardUploads';
import { seedFromWorkspaceDefault, accessValueToAccess } from './TemplateAccessControl';
import { setTemplateAccess } from '../lib/api/templateAccess';
import { deletePrompt as deletePromptApi } from '../lib/api/prompts';
import { AVAILABLE_MODELS } from '../constants';
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
  // SQEM-315 — uploaded documents, held only in memory. Deliberately NOT `WorkspaceFile[]`:
  // the type would invite somebody to merge the two lists again, and the merge is the bug.
  const [uploads, setUploads] = useState<{ name: string; text: string }[]>([]);
  // SQEM-316 — PDFs and images travel as model parts, not as text. Same rule: never stored.
  const [binaries, setBinaries] = useState<{ name: string; mimeType: string; data: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  // SQEM-317 — what is happening right now. ⛔ Still no progress bar (SQEM-308: we do not know
  // the duration, and a bar stuck at 90 % is the worse lie). A stage name claims no duration —
  // it is the difference between "slow" and "hung".
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // ⛔ Only reset on a *successful* close. A failed run keeps everything: the goal is the work the
  // person put in, and throwing it away to show them an error is the worst possible trade.
  const closeAndReset = () => {
    setKind('prompt'); setGoal(''); setFiles([]); setUploads([]); setBinaries([]); setError(null);
    onClose();
  };

  /** A Blob to base64 without the `data:` prefix — the shape `inlineData` wants. */
  const blobToBase64 = (b: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { const v = String(r.result ?? ''); const i = v.indexOf(','); resolve(i >= 0 ? v.slice(i + 1) : v); };
      r.onerror = () => reject(new Error('unreadable'));
      r.readAsDataURL(b);
    });

  const attach = (picked: WorkspaceFile[]) => {
    setFiles(prev => [...prev, ...picked.filter(p => !prev.some(f => f.id === p.id))]);
    setPicking(false);
  };

  // SQEM-315 — an uploaded document is **material, and is never stored**. It is read here in the
  // browser and the bytes never leave it.
  //
  // ⛔ Not "upload then delete": every path that does not reach the delete — cancel, a failed
  // generation, a closed tab — would leave the file in the library. The only version of "not kept"
  // that holds is not sending it.
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!picked.length) return;
    // SQEM-316 — what is possible depends on which model will read it, so the provider is part of
    // the question. ⛔ Asked *here*, at pick time: finding out after a minute of generation that the
    // document was never usable is the expensive way to learn it.
    const provider = AVAILABLE_MODELS.find(m => m.id === authoringModelId(workspace ?? null))?.provider
      ?? (workspace && !authoringModelId(workspace) ? 'sqemes' : null);

    for (const f of picked) {
      const verdict = classifyUpload(f, provider);
      if (verdict.ok === false) { showToast(verdict.reason, 'error'); continue; }
      try {
        if (verdict.binary) {
          const data = await readFileAsBase64(f);
          setBinaries(prev => [...prev.filter(b => b.name !== f.name), { name: f.name, mimeType: f.type || 'application/pdf', data }]);
        } else {
          const text = (await readFileAsText(f)).trim();
          if (text) setUploads(prev => [...prev.filter(u => u.name !== f.name), { name: f.name, text }]);
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : `${f.name} could not be read.`, 'error');
      }
    }
  };

  /**
   * The attached workspace files' contents, so they shape the template as well as ride along.
   *
   * ⛔ **SQEM-317 — this used to run `res.text()` over everything, including PDFs.** An *uploaded*
   * PDF was handled properly while an *attached* one arrived as decoded binary in the same prompt:
   * a contradiction SQEM-316 created by fixing only one of the two paths. PDFs are in the upload
   * allowlist, so it was the normal case, not an edge one.
   *
   * ⚠️ **Mojibake is worse than omitting the file.** It costs tokens, confuses the model, and reads
   * as the model being bad at its job rather than as a defect of ours.
   *
   * A file whose contents cannot be used **stays attached regardless** — that is the promise from
   * SQEM-315; only its influence on the writing is lost.
   */
  const readAttachments = async (provider: string | null) => {
    // SQEM-318 — in parallel. These used to be sequential round trips *before* the first model call
    // even started; five attachments meant five waits stacked end to end.
    // ⚠️ Unthrottled on purpose, and only defensible because the set is bounded: a person picked it.
    // Over an unbounded list `Promise.all` would be the wrong answer.
    const results = await Promise.all(files.map(async f => {
      try {
        const verdict = classifyUpload({ name: f.name, type: f.mimeType, size: f.sizeBytes }, provider);
        if (verdict.ok === false) return null;       // attached anyway; its contents just cannot help
        const res = await fetch(await getWorkspaceFileSignedUrl(f.storagePath));
        if (verdict.binary) {
          return { kind: 'binary' as const, name: f.name, mimeType: f.mimeType, data: await blobToBase64(await res.blob()) };
        }
        const t = (await res.text()).trim();
        return t ? { kind: 'text' as const, name: f.name, text: t } : null;
      } catch {
        return null;                                  // unreadable is context we do without
      }
    }));
    return {
      text: results.filter((r): r is { kind: 'text'; name: string; text: string } => r?.kind === 'text'),
      binary: results.filter((r): r is { kind: 'binary'; name: string; mimeType: string; data: string } => r?.kind === 'binary'),
    };
  };

  const run = async () => {
    if (!workspace?.brandProfile || !currentUser || !goal.trim()) return;
    setBusy(true); setError(null);
    setStage(files.length ? 'Reading your documents' : 'Reading your brand');
    const provider = AVAILABLE_MODELS.find(m => m.id === authoringModelId(workspace))?.provider
      ?? (authoringModelId(workspace) ? null : 'sqemes');
    try {
      const attachments = await readAttachments(provider);
      setStage(`Writing your ${KINDS.find(k => k.value === kind)?.label.toLowerCase()}`);
      const draft = await generateSingleTemplate(
        kind,
        goal.trim(),
        attachments.text,
        uploads,
        // The workspace's own files as index data — name, tags, type, size, no content.
        // ⛔ This list comes from a plain `select('*')`, so RLS has already limited it to what this
        // person may see. That is the access answer; a second one here would be a second place to
        // get wrong. Only offered when there is source material to relate them to.
        (uploads.length || binaries.length) ? workspaceFiles.map(f => ({ name: f.name, tags: f.tags, mimeType: f.mimeType, sizeBytes: f.sizeBytes })) : [],
        {
          brandName: workspace.brandProfile.brandName,
          whatItDoes: workspace.brandProfile.whatItDoes,
          audience: workspace.brandProfile.audience,
          tone: workspace.brandProfile.tone,
          useCase: workspace.brandProfile.useCase,
        },
        { workspaceId: workspace.id, modelId: authoringModelId(workspace) },
        [...binaries, ...attachments.binary],
      );

      // SQEM-315 — three sources of context files, and only one of them is a judgement.
      //
      // 1. **Attached: kept unconditionally.** Somebody chose these deliberately; the generation
      //    does not get to drop them. (This reverses the 2026-09-01 "the generation decides" rule,
      //    which now governs only what the model *finds*.)
      const attachedIds = files.map(f => f.id);

      // 2. **Written by the model** from the uploaded material. These are real workspace files —
      //    the upload was not kept, its distilled result is.
      const writtenIds: string[] = [];
      // SQEM-318 — the model names the file, we impose the rules it cannot know: no path segments,
      // always `.md`, and no silent collision. Sequential on purpose — each name must see the ones
      // already taken, including the ones this very run created.
      const takenNames = workspaceFiles.map(f => f.name);
      for (const nf of draft.newFiles) {
        try {
          const name = generatedFileName(nf.name, takenNames);
          takenNames.push(name);
          const created = await uploadWorkspaceFile(
            workspace.id,
            new File([nf.content], name, { type: 'text/markdown' }),
            [],
          );
          addWorkspaceFile(created);
          writtenIds.push(created.id);
        } catch {
          // A context file that cannot be saved must not cost the template the person is waiting
          // for. It is missing, not fatal — and the editor shows exactly what did land.
        }
      }

      // 3. **Existing workspace files the model shortlisted**, confirmed by a second pass that
      //    actually reads them. ⛔ Resolved against the same RLS-filtered list and nothing else: a
      //    name that is not in it is discarded, never looked up. A model naming a file it should
      //    not see must not become a lookup that finds it.
      // ⛔ SQEM-317 — stage two runs *after* the template is written, so a timeout, a 503 or broken
      // JSON here used to throw away finished work. **A secondary step must never destroy the
      // primary result.** It degrades to "no files found" and everything else is saved.
      let foundIds: string[] = [];
      try {
      if (draft.inspectFiles.length) {
        setStage('Looking through your files');
        const shortlist = resolveVisibleFiles(draft.inspectFiles, workspaceFiles);
        // SQEM-318 — likewise parallel; the model shortlisted a handful, not a library.
        const loaded = (await Promise.all(shortlist.map(async f => {
          try {
            const res = await fetch(await getWorkspaceFileSignedUrl(f.storagePath));
            const text = (await res.text()).trim();
            return text ? { name: f.name, text } : null;
          } catch {
            return null;                              // unreadable candidate — simply not a candidate
          }
        }))).filter((x): x is { name: string; text: string } => x !== null);
        const keepNames = await pickHelpfulFiles(goal.trim(), loaded, {
          workspaceId: workspace.id,
          modelId: authoringModelId(workspace),
        });
        foundIds = resolveVisibleFiles(keepNames, workspaceFiles).map(f => f.id);
      }
      } catch { /* see above — the template survives */ }

      setStage('Saving');
      const keep = Array.from(new Set([...attachedIds, ...writtenIds, ...foundIds]));

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

      // ⛔ SQEM-318 — the workspace's access default applies here too, and it did not before.
      //
      // Only `TemplateEditor` read `defaultTemplateAccess`; the wizard wrote no `template_access`
      // rows at all — and no rows means **open to everyone**. A workspace set to "new templates
      // start restricted" was getting wizard templates the whole team could see, with nothing on
      // screen saying otherwise.
      //
      // ⚠️ **The rollback is copied from `duplicatePrompt` (SQEM-246), and only fires where it must.**
      // An open default produces no rules, so there is nothing to apply and nothing at risk. A
      // restricted default that fails to apply leaves a template **more open than intended** — and a
      // template that stays visible behind a toast nobody reads is exactly the case that ticket was
      // written for. Better to lose a generated template than to publish one by accident.
      const defaultAccess = accessValueToAccess(
        seedFromWorkspaceDefault(workspace.defaultTemplateAccess ?? []),
        currentUser.id,
      );
      if (defaultAccess.hasRules) {
        try {
          await setTemplateAccess(created.id, workspace.id, defaultAccess);
        } catch (accessErr) {
          await deletePromptApi(created.id).catch(() => { /* nothing better to try */ });
          throw new Error(
            `Generated, but the workspace's access default could not be applied — the template was removed rather than left open to everyone. ${accessErr instanceof Error ? accessErr.message : ''}`.trim(),
          );
        }
      }

      closeAndReset();
      // Straight into the editor: the person has to see what was made, and — because the generation
      // chose the context files — which documents came along.
      // SQEM-313 — `/edit`, and the suffix is the whole fix. `/prompts/:id` is `PromptRunnerRedirect`,
      // a shim that catches links to the removed PromptRunner and sends them to Chat — so the wizard
      // finished by opening the template in a chat instead of the editor. ⛔ It looked like success:
      // no error, no 404, the template right there. The editor is also where the attached context
      // files are visible, which SQEM-308 required and Chat cannot show.
      navigate(`/prompts/${created.id}/edit`);
    } catch (err) {
      setError(describeAIError(err, 'Generating the template failed.', { alternativesAvailable: hasAuthoringAlternatives(workspace) }));
    } finally {
      setBusy(false); setStage('');
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
          <p className="mt-5 text-sm font-bold text-slate-800 dark:text-slate-100">{stage || `Writing your ${KINDS.find(k => k.value === kind)?.label.toLowerCase()}`}…</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">This can take a minute when documents are involved.</p>
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

          {/* ⛔ SQEM-315 — the two lists are shown apart because they now *do* different things, and
              one sentence covering both was what made the old behaviour impossible to predict.
              Attached files ride along; an upload is read and thrown away. Saying that here is the
              difference between a person choosing the right button and finding out afterwards. */}
          {files.length > 0 && (
            <div className="mt-3">
              <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Attached — kept on the template</p>
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
              <p className="text-2xs text-slate-400 dark:text-slate-500 mt-2">These stay attached, and their contents also shape what gets written.</p>
            </div>
          )}

          {(uploads.length > 0 || binaries.length > 0) && (
            <div className="mt-3">
              <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Source material — not saved</p>
              <div className="flex flex-wrap gap-1.5">
                {[...uploads.map(u => ({ name: u.name })), ...binaries.map(b => ({ name: b.name }))].map(u => (
                  <span key={u.name} className="inline-flex items-center gap-1 text-xs bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/50 rounded-lg px-2 py-1 text-brand-700 dark:text-brand-300">
                    {u.name}
                    <button type="button" onClick={() => { setUploads(prev => prev.filter(x => x.name !== u.name)); setBinaries(prev => prev.filter(x => x.name !== u.name)); }} className="text-brand-400 hover:text-red-500" aria-label={`Remove ${u.name}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-2xs text-slate-400 dark:text-slate-500 mt-2">Read, then discarded — these files are not added to your library. What the template needs from them is written into new context files, and existing files that help are attached.</p>
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
