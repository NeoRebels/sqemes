import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useUI, useWorkspace, usePrompts, useData } from '../store';
import { can } from '../lib/permissions';
import { IS_SELF_HOSTED } from '../lib/env';
import { Prompt, Variable, VariableType, PromptKind, WorkspaceFile, TemplateCategory, LibraryTemplate, Step, UserRole } from '../types';
import { fetchPromptDetail } from '../lib/api/prompts';
import { fetchLibraryTemplateDetail } from '../lib/api/library';
import { TEMPLATE_CATEGORIES, KIND_HELP } from '../constants';
import { buildEnabledModels } from '../lib/enabledModels';
import { runAuthoringAI, authoringModelId } from '../lib/authoringAI';
import { enhancePrompt, enhanceInput, describePrompt } from '../supabase/functions/_shared/authoringPrompts.ts';
import { Save, Plus, Trash2, Settings, Edit, ChevronDown, Copy, PenTool, Eye, EyeOff, GripVertical, Sparkles, Loader2, AlertTriangle, Wand2, FlaskConical, History, UserRound, Users, Lock } from 'lucide-react';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import FieldTooltip from '../components/FieldTooltip';
import { ContextFilePicker } from '../components/ContextFilePicker';
import { TagPicker } from '../components/TagPicker';
import { UploadFileModal } from '../components/UploadFileModal';
import { TemplateAccessControl, seedFromWorkspaceDefault, accessToValue, accessValueToAccess, unrepresentableRoleGrants, type TemplateAccessValue } from '../components/TemplateAccessControl';
import { accessAppliesTo, isMultiSeat } from '../lib/templateAccessScope';
import PersonCard from '../components/ui/PersonCard';
import MoveButtons from '../components/ui/MoveButtons';
import { moveItem } from '../lib/moveItem';
import { fetchTemplateAccess, setTemplateAccess } from '../lib/api/templateAccess';
import { fetchEditors, setEditors, fetchEditRights } from '../lib/api/editors';
import { fetchGroups } from '../lib/api/groups';
import EditorTestPanel from '../components/EditorTestPanel';
import VersionHistoryPanel from '../components/VersionHistoryPanel';
import KindBadge from '../components/ui/KindBadge';
import FullScreenExit from '../components/ui/FullScreenExit';

// Marketplace library templates store their body as a single rich-text step;
// normalise to plain text when loading into the unified content editor.
const stripHtml = (html: string): string => {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};


const TemplateEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // SQEM-106 — one editor for both workspace playbooks (/playbooks/*, SQEM-394) and curated
  // marketplace templates (/library/*). Target is derived from the route.
  const isLibrary = location.pathname.startsWith('/library');
  const listPath = isLibrary ? '/library' : '/playbooks';
  const { addPrompt, updatePrompt, deletePrompt, duplicatePrompt } = usePrompts();
  const { workspace, currentUser, updateWorkspace, isSqemesAdmin } = useWorkspace();
  const { showToast } = useUI();
  const { workspaceFiles, addWorkspaceFile, addLibraryTemplate, updateLibraryTemplate, deleteLibraryTemplate } = useData();
  const [libraryCategory, setLibraryCategory] = useState<TemplateCategory>('Marketing & Sales');
  const [uploadOpen, setUploadOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [formData, setFormData] = useState<Prompt>({
    id: crypto.randomUUID(),
    workspaceId: workspace?.id || '',
    kind: 'prompt',
    title: '',
    description: '',
    tag: null,
    variables: [],
    content: '',
    contextFileIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: currentUser?.id || '',
    usageCount: 0,
    published: !isLibrary, // new marketplace templates start as draft
  });

  const [showVarModal, setShowVarModal] = useState(false);
  const [newVar, setNewVar] = useState<Partial<Variable>>({ type: 'text' });
  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [varOptionsString, setVarOptionsString] = useState('');
  const [varNameError, setVarNameError] = useState<string | null>(null);


  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [mobileTab, setMobileTab] = useState<'editor' | 'settings' | 'test'>('editor');

  const [draggedVarId, setDraggedVarId] = useState<string | null>(null);
  const [dragOverVarId, setDragOverVarId] = useState<string | null>(null);
  const [testResetKey, setTestResetKey] = useState(0);
  // SQEM-477 — the right panel: the version history of a saved workspace playbook, and the test chat.
  // History first when there is one; a new playbook or a marketplace template has none to show.
  const hasHistory = !!id && !isLibrary;
  const saveLabel = isLibrary ? 'Save playbook' : id ? 'Save changes' : 'Create playbook';
  const [rightTab, setRightTab] = useState<'history' | 'test'>(hasHistory ? 'history' : 'test');
  const [historyKey, setHistoryKey] = useState(0);
  useEffect(() => { if (!hasHistory) setRightTab('test'); }, [hasHistory]);
  // SQEM-142 — per-template role access. New templates inherit the workspace default; existing
  // ones load their rules below. Empty roles = open to everyone.
  // SQEM-211 — "restricted by default" seeds "Only me": nobody else has been picked yet, and that
  // is a state the control can show. It used to seed a role row the editor can no longer represent.
  const [access, setAccess] = useState<TemplateAccessValue>(() => seedFromWorkspaceDefault(workspace?.defaultTemplateAccess ?? []));
  // SQEM-292 — the workspace's groups, so the access control can offer them. Everyone in the
  // workspace may read them (RLS); only admins may change them, which happens in Settings.
  const [groups, setGroups] = useState<{ id: string; name: string; memberIds: string[] }[]>([]);
  // SQEM-238 — role grants stored on this template that the access list cannot render. Kept apart
  // from `access` because they are not part of the choice: they describe what is stored today.
  const [legacyRoles, setLegacyRoles] = useState<UserRole[]>([]);
  // SQEM-241 — who the template belongs to. `created_by` decides whether "Only me" is even
  // available, so the person making that choice should be able to see the answer rather than infer
  // it from a disabled button. Resolvable only against the current members: `created_by` survives a
  // removal from the workspace (it is `on delete set null` on the *profile*, not on membership), so
  // "not found" is a real and distinct state from "none recorded".
  const owner = useMemo(
    () => (workspace?.members ?? []).find(m => m.id === formData.createdBy),
    [workspace?.members, formData.createdBy],
  );

  // SQEM-473 — the ROLE says whether this person edits playbooks at all; the playbook may still name its
  // editors. `canEdit` is both, and it is what every control below already keys on, so a playbook you
  // may use but not change opens read-only instead of letting you type into a save that RLS refuses.
  const roleCanEdit = isLibrary ? isSqemesAdmin : can(currentUser, workspace, 'prompts:edit');
  const [editRight, setEditRight] = useState(true);
  const [canManageEditors, setCanManageEditors] = useState(!id); // a new playbook is its creator's own
  // SQEM-534 — a NEW one starts as the workspace default says; the database writes the same restriction
  // on insert, so this only shows it (and lets the creator open it again before the first save).
  const [editors, setEditorsValue] = useState<TemplateAccessValue>(() => ({
    mode: !id && workspace?.defaultEditRestricted ? 'restricted' : 'everyone', userIds: [], groupIds: [],
  }));
  const [editorsDirty, setEditorsDirty] = useState(false);
  const canEdit = roleCanEdit && (isLibrary || editRight);

  // Marketplace editor is Sqemes-admin only.
  useEffect(() => {
    if (isLibrary && !isSqemesAdmin) navigate('/library');
  }, [isLibrary, isSqemesAdmin, navigate]);

  // SQEM-573 — the picker's list, so an added OpenRouter id counts (no built-in OpenRouter models any more).
  const enabledModels = buildEnabledModels(workspace.apiKeys, workspace.openrouterModels);
  // SQEM-082 — AI authoring is usable with a BYOK model OR Sqemes-funded credits (keyless).
  const canUseAI = enabledModels.length > 0 || !!workspace.fundedAvailable;


  // Map a loaded marketplace LibraryTemplate into the editor's Prompt-shaped model.
  const libraryToForm = (t: LibraryTemplate): Prompt => ({
    id: t.id,
    workspaceId: workspace?.id || '',
    kind: t.kind,
    title: t.title,
    description: t.description,
    tag: null,
    variables: t.variables,
    content: stripHtml((t.steps?.[0]?.content as string) ?? ''),
    contextFileIds: [],
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    createdBy: t.createdBy,
    usageCount: t.usageCount,
    published: t.published,
  });

  // Map the editor's Prompt-shaped model back into a LibraryTemplate for saving.
  const formToLibrary = (data: Prompt): LibraryTemplate => ({
    id: data.id,
    kind: data.kind,
    title: data.title,
    description: data.description,
    category: libraryCategory,
    tags: [],
    variables: data.variables,
    steps: [{ id: crypto.randomUUID(), title: data.title || 'Content', content: data.content, model: '', includePreviousResult: false } as Step],
    createdBy: data.createdBy,
    usageCount: data.usageCount,
    published: data.published,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  });

  useEffect(() => {
    if (id) {
      const load = isLibrary
        ? fetchLibraryTemplateDetail(id).then(full => {
            setFormData(libraryToForm(full));
            setLibraryCategory(full.category);
            setIsDirty(false);
          })
        : fetchPromptDetail(id).then(full => {
            setFormData(full);
            setIsDirty(false);
          });
      load.catch(() => {});
    } else if (!isLibrary && location.state?.template) {
      const tpl = location.state.template as Prompt;
      setFormData({
        ...tpl,
        id: crypto.randomUUID(),
        workspaceId: workspace?.id || '',
        kind: 'prompt',
      });
      setIsDirty(false);
    }
  }, [id, location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // SQEM-142 / SQEM-143 — load an existing workspace template's access rules (roles + users).
  useEffect(() => {
    if (id && !isLibrary) {
      // SQEM-211 — members are passed so a legacy `role=member` row resolves into the people it
      // currently covers, instead of silently disappearing from a control that no longer shows roles.
      fetchTemplateAccess(id).then(a => {
        setAccess(accessToValue(a.roles, a.userIds, a.hasRules, workspace?.members ?? [], a.groupIds ?? []));
        setLegacyRoles(unrepresentableRoleGrants(a.roles));
      }).catch(() => {});
    }
  }, [id, isLibrary, workspace?.members]);

  // SQEM-473 — who may change this playbook, and whether this person may (both from the database).
  useEffect(() => {
    if (!id || isLibrary) return;
    fetchEditors('template', id).then(e => setEditorsValue({
      mode: e.userIds.length || e.groupIds.length ? 'restricted' : 'everyone', userIds: e.userIds, groupIds: e.groupIds,
    })).catch(() => {});
    fetchEditRights('template', id).then(r => { setEditRight(r.canEdit); setCanManageEditors(r.canManage); }).catch(() => {});
  }, [id, isLibrary]);

  // SQEM-292 — load the groups the access control offers. Separate from the rules above because it
  // is about the workspace, not this template: a new template has no rules yet but still needs the
  // list. Failure is silent by design — the People tab still works, and a toast about groups while
  // somebody is writing a template would interrupt the wrong task.
  useEffect(() => {
    if (isLibrary || !workspace?.id) return;
    fetchGroups(workspace.id).then(setGroups).catch(() => {});
  }, [isLibrary, workspace?.id]);

  const handleSave = async () => {
    if (!formData.title.trim()) {
      showToast('Playbook title is required.', 'error');
      return;
    }
    const saveData = formData;
    if (isLibrary) {
      const tpl = formToLibrary(saveData);
      if (id) {
        await updateLibraryTemplate(tpl);
      } else {
        const created = await addLibraryTemplate(tpl);
        if (created) navigate(`/library/${created.id}/edit`, { replace: true });
      }
      showToast('Playbook saved', 'success');
      setIsDirty(false);
      return;
    }
    let savedId = id;
    if (id) {
      await updatePrompt(saveData);
    } else {
      const created = await addPrompt(saveData);
      savedId = created?.id;
    }
    // SQEM-142 / SQEM-143 — persist the access rules (roles + users; empty = open). Non-fatal.
    if (savedId) {
      try {
        await setTemplateAccess(savedId, workspace.id, accessValueToAccess(access, formData.createdBy || null));
        // SQEM-238 — the old role grant is gone now; the warning must go with it, or it keeps
        // warning about a rule that no longer exists.
        setLegacyRoles([]);
      } catch {
        showToast('Saved, but updating access failed — try again.', 'error');
      }
      // SQEM-473 — the editor list, only by someone who may set it (owner or admin; RLS enforces it).
      // ⛔ "Only selected people" with nobody ticked must still RESTRICT: no row means "no restriction"
      // in the database, so the owner (or, for a playbook without one, whoever saves) is written as
      // the single editor. The owner is filtered out of the list on read, so the control shows nobody.
      if (canManageEditors && editorsDirty) {
        try {
          const named = { userIds: editors.userIds, groupIds: editors.groupIds ?? [] };
          if (editors.mode === 'restricted' && named.userIds.length === 0 && named.groupIds.length === 0) {
            named.userIds = [formData.createdBy || currentUser.id];
          }
          await setEditors('template', savedId, workspace.id, editors.mode === 'restricted' ? named : { userIds: [], groupIds: [] });
          setEditorsDirty(false);
        } catch {
          showToast('Saved, but updating who can edit failed — try again.', 'error');
        }
      }
    }
    if (!id && savedId) navigate(`/playbooks/${savedId}/edit`, { replace: true });
    showToast('Prompt successfully saved', 'success');
    setIsDirty(false);
    setHistoryKey(k => k + 1);
  };

  // SQEM-477 — a restore wrote a new version in the database; show its state and drop unsaved edits.
  const handleRestored = async ({ version, missingFiles }: { version: number | null; missingFiles: string[] }) => {
    if (!id) return;
    if (version === null) {
      showToast('That version is already the current state — nothing changed.', 'info');
      return;
    }
    try {
      const full = await fetchPromptDetail(id);
      setFormData(full); // the list follows by itself: the store hears the UPDATE over realtime
      setIsDirty(false);
    } catch { /* the version exists; a reload shows it */ }
    setHistoryKey(k => k + 1);
    showToast(
      missingFiles.length
        ? `Restored as version ${version}. Left out because deleted: ${missingFiles.join(', ')}.`
        : `Restored as version ${version}.`,
      missingFiles.length ? 'info' : 'success',
    );
  };

  const handleBack = () => {
    if (isDirty) {
      setShowDiscardModal(true);
    } else {
      navigate(listPath);
    }
  };

  const handleDeleteClick = () => {
    if (!id) return;
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (id) {
      if (isLibrary) {
        deleteLibraryTemplate(id);
        navigate('/library');
        showToast('Playbook deleted', 'success');
      } else {
        deletePrompt(id);
        navigate('/playbooks');
        showToast('Prompt deleted', 'success');
      }
    }
  };

  const handleDuplicate = () => {
    if (id) {
      duplicatePrompt(formData);
      navigate('/playbooks');
      showToast('Prompt duplicated', 'success');
    }
  };

  const VAR_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  const saveVariable = () => {
    if (!newVar.name || !newVar.label) return;
    const normalizedName = newVar.name.replace(/\s+/g, '_').toLowerCase();
    if (!VAR_NAME_REGEX.test(normalizedName)) {
      setVarNameError('Name must start with a letter or underscore and contain only letters, numbers, and underscores.');
      return;
    }
    const RESERVED_NAMES = ['previous_result'];
    if (RESERVED_NAMES.includes(normalizedName)) {
      setVarNameError(`"${normalizedName}" is a reserved name.`);
      return;
    }
    const isDuplicate = formData.variables.some(v => v.name === normalizedName && v.id !== editingVarId);
    if (isDuplicate) {
      setVarNameError(`A variable named "${normalizedName}" already exists.`);
      return;
    }
    setVarNameError(null);
    const optionsArray = newVar.type === 'select' && varOptionsString
      ? varOptionsString.split(',').map(s => s.trim()).filter(s => s !== '')
      : undefined;
    const v: Variable = {
      id: editingVarId || crypto.randomUUID(),
      name: normalizedName,
      label: newVar.label,
      type: newVar.type as VariableType,
      options: optionsArray,
      defaultValue: newVar.defaultValue,
    };
    if (editingVarId) {
      setFormData(prev => ({ ...prev, variables: prev.variables.map(vv => vv.id === editingVarId ? v : vv) }));
    } else {
      setFormData(prev => ({ ...prev, variables: [...prev.variables, v] }));
    }
    setShowVarModal(false);
    setNewVar({ type: 'text' });
    setVarOptionsString('');
    setEditingVarId(null);
    setIsDirty(true);
  };

  const openNewVariableModal = () => {
    setNewVar({ type: 'text' });
    setVarOptionsString('');
    setEditingVarId(null);
    setVarNameError(null);
    setShowVarModal(true);
  };

  const openEditVariable = (v: Variable) => {
    setNewVar({ ...v });
    setVarOptionsString(v.options ? v.options.join(', ') : '');
    setEditingVarId(v.id);
    setShowVarModal(true);
  };

  const insertVariableToken = (varName: string) => {
    const token = `{{${varName}}}`;
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = formData.content.substring(0, start) + token + formData.content.substring(end);
      setFormData(prev => ({ ...prev, content: next }));
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + token.length;
        textarea.focus();
      });
    } else {
      setFormData(prev => ({ ...prev, content: prev.content + token }));
    }
    setIsDirty(true);
  };

  const setTag = (tag: string | null) => {
    setFormData(prev => ({ ...prev, tag }));
    setIsDirty(true);
  };

  // Create a new workspace tag (registry) and select it.
  const handleCreateTag = (name: string) => {
    const tag = name.trim();
    if (!tag) return;
    if (!workspace.tags.includes(tag)) updateWorkspace({ tags: [...workspace.tags, tag] });
    setTag(tag);
  };

  // Attach freshly uploaded files: add to the store + select on this template.
  const handleUploaded = (uploaded: WorkspaceFile[]) => {
    uploaded.forEach(f => addWorkspaceFile(f));
    setFormData(prev => ({ ...prev, contextFileIds: [...prev.contextFileIds, ...uploaded.map(f => f.id)] }));
    setIsDirty(true);
    setUploadOpen(false);
  };

  const handleVarDragStart = (e: React.DragEvent, vid: string) => {
    setDraggedVarId(vid);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleVarDragOver = (e: React.DragEvent, vid: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (vid !== draggedVarId) setDragOverVarId(vid);
  };

  const handleVarDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedVarId || draggedVarId === targetId) { setDraggedVarId(null); setDragOverVarId(null); return; }
    const vars = formData.variables;
    const from = vars.findIndex(v => v.id === draggedVarId);
    const to = vars.findIndex(v => v.id === targetId);
    setFormData(prev => ({ ...prev, variables: moveItem(vars, from, to) }));
    setIsDirty(true);
    setDraggedVarId(null);
    setDragOverVarId(null);
  };

  // SQEM-540 — the same reordering without dragging (keyboard, touch).
  const moveVariable = (from: number, to: number) => {
    setFormData(prev => ({ ...prev, variables: moveItem(prev.variables, from, to) }));
    setIsDirty(true);
  };

  const handleVarDragEnd = () => {
    setDraggedVarId(null);
    setDragOverVarId(null);
  };

  const handleEnhance = async () => {
    const textContent = formData.content.trim();
    if (!textContent) {
      showToast('Please enter some text to enhance.', 'error');
      return;
    }
    setIsEnhancing(true);
    try {
      // SQEM-311 — the workspace's chosen authoring model, or the first text model with a key.
      // This used to redo the image-model filter inline; that rule now has one home.
      // No BYOK text model → null, and runAuthoringAI routes to Sqemes-funded credits (Cloud-only).
      const modelId = authoringModelId(workspace);

      // SQEM-390 — the instruction is chosen by KIND, from the one module every authoring surface
      // reads. Until now the prompt-engineering text (preserve {{variables}}, "Header → Content →
      // Action") was applied to skills too, and a skill came back shaped like a task.
      const enhanced = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId,
        systemInstruction: enhancePrompt(formData.kind),
        prompt: enhanceInput(formData.kind, textContent),
      });
      if (enhanced) {
        setFormData(prev => ({ ...prev, content: enhanced }));
        showToast(formData.kind === 'skill' ? 'Skill enhanced with AI magic! ✨' : 'Prompt enhanced with AI magic! ✨', 'success');
        setIsDirty(true);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to enhance prompt', 'error');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleGenerateDescription = async () => {
    const textContent = formData.content.trim();
    if (!textContent) return;
    setIsGeneratingDescription(true);
    try {
      // SQEM-311 — see the note in handleEnhance.
      const modelId = authoringModelId(workspace);

      const generated = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId,
        systemInstruction: describePrompt(formData.kind), // SQEM-390 — per kind, from the shared module
        prompt: textContent,
      });
      if (generated) {
        setFormData(prev => ({ ...prev, description: generated.trim() }));
        setIsDirty(true);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to generate description', 'error');
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-surface overflow-hidden">
      {/* Header */}
      <header className="bg-surface-raised border-b border-line h-16 px-4 md:px-6 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-2">
          {/* SQEM-208 — same exit as Chat and the marketplace detail page. `onExit` is the editor's
              own `handleBack`, so the unsaved-changes guard keeps working untouched.
              Escape is deliberately OFF here: an editor has many local Escape consumers (dropdowns,
              tag picker, test panel, several modals), and any one not enumerated would turn Escape
              into "leave the page" when the user only meant "close this menu". Chat's states were
              knowable and complete; an editor's are not. Flip `escapeEnabled` if that changes. */}
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-8 h-8 rounded-lg shrink-0" />
          {/* SQEM-544 — the page's h1, for screen readers; the visible title is the field below. */}
          <h1 className="sr-only">{formData.title || (id ? 'Edit playbook' : 'New playbook')}</h1>
          <FullScreenExit
            label={isLibrary ? 'Back to Marketplace' : 'Back to Playbooks'}
            onExit={handleBack}
          />
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {id && roleCanEdit && (
            <>
              {/* SQEM-473 — a copy is a new playbook of your own, so it needs the role, not this one's edit right. */}
              {!isLibrary && (
                <button onClick={handleDuplicate} className="p-2 text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors hidden sm:block" title="Duplicate">
                  <Copy className="w-5 h-5" />
                </button>
              )}
              {canEdit && (
                <button onClick={handleDeleteClick} className="p-2 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors hidden sm:block" title="Delete">
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </>
          )}
          {canEdit && (
            // SQEM-539 — one verb per situation, the same in both editors: Create for a new one, Save
            // changes for an existing one. Named for the phone too, where only the icon shows.
            <button onClick={handleSave} aria-label={saveLabel} className="flex items-center gap-2 bg-accent-strong hover:opacity-90 text-white px-4 md:px-5 py-2 rounded-control font-semibold text-sm transition-opacity whitespace-nowrap">
              <Save className="w-4 h-4" /> <span className="hidden sm:inline">{saveLabel}</span>
            </button>
          )}
        </div>
      </header>

      {/* SQEM-473 — this person may use the playbook but not change it. Said once, at the top, with
          whom to ask: a read-only editor without a reason reads as a bug. */}
      {!isLibrary && id && roleCanEdit && !editRight && (
        <div className="flex items-start gap-2.5 border-b border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 px-4 md:px-6 py-2.5">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-semibold">You can use this playbook but not change it.</span>{' '}
            Editing is limited to the people its owner{owner ? ` (${owner.name || owner.email})` : ''} chose. Ask them or a workspace admin.
          </p>
        </div>
      )}

      {/* Mobile Tab Switcher */}
      <div className="xl:hidden flex border-b border-line bg-surface-raised">
        <button
          onClick={() => setMobileTab('editor')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === 'editor' ? 'text-ink-strong border-b-2 border-accent' : 'text-ink-muted'}`}
        >
          <PenTool className="w-4 h-4" /> Editor
        </button>
        <button
          onClick={() => setMobileTab('test')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === 'test' ? 'text-ink-strong border-b-2 border-accent' : 'text-ink-muted'}`}
        >
          {hasHistory ? <><History className="w-4 h-4" /> History · Test</> : <><FlaskConical className="w-4 h-4" /> Test</>}
        </button>
        <button
          onClick={() => setMobileTab('settings')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === 'settings' ? 'text-ink-strong border-b-2 border-accent' : 'text-ink-muted'}`}
        >
          <Settings className="w-4 h-4" /> Settings
        </button>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden relative">
        {/* Left Sidebar: Settings */}
        {/* SQEM-387 — `flex-1 min-h-0` below `xl`, where this is a COLUMN: with `shrink-0` the panel grew to its content and the parent's `overflow-hidden` cut it off — nothing to scroll. On `xl` it is a row again and `xl:flex-none` keeps the fixed width. */}
        <div className={`w-full xl:w-[380px] bg-surface-sunken/60 border-r border-line overflow-y-auto p-6 flex-1 min-h-0 xl:flex-none ${mobileTab === 'settings' ? 'block' : 'hidden xl:block'}`}>
          <div className="space-y-8">

            {/* Kind selector */}
            {canEdit && (
              <div>
                <p className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Type</p>
                <div role="group" aria-label="Type" className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
                  {([
                    { kind: 'prompt' as PromptKind, label: 'Prompt', icon: <PenTool className="w-3.5 h-3.5" /> },
                    { kind: 'skill' as PromptKind, label: 'Skill', icon: <Wand2 className="w-3.5 h-3.5" /> },
                  ] as const).map(({ kind, label, icon }) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, kind }));
                        setIsDirty(true);
                      }}
                      aria-pressed={formData.kind === kind}
                      aria-describedby="kind-help"
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                        formData.kind === kind
                          ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
                {/* SQEM-204 — the product's central decision used to sit here completely unlabelled:
                    no description, no title, no aria anything. Meanwhile the marketplace explained the
                    same kinds well, by example rather than by definition — the knowledge existed,
                    just not where the choice is made. Wording checked against the product definitions; the
                    examples are real marketplace listings, so what a reader sees here and there agrees.
                    `aria-describedby` points every tab at this line so it is read out too. */}
                <p id="kind-help" className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                  {KIND_HELP[formData.kind]}
                </p>
              </div>
            )}

            {/* SQEM-330 — "Description", not "About". The column is `description`, the persona editor
                says Description, and the marketplace card shows it under that name. Three words for
                one field is the pattern SQEM-287 measured on the provider keys, where the same
                thing was called three different things in three screens. */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label htmlFor="template-editor-description" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Description</label>
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleGenerateDescription}
                    disabled={isGeneratingDescription || !formData.content.trim() || !canUseAI}
                    title={
                      !formData.content.trim() ? 'Enter content first' :
                      !canUseAI ? 'Add an API key in Settings' :
                      'Generate description with AI'
                    }
                    className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isGeneratingDescription
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Generating...</>
                      : <><Sparkles className="w-3 h-3" />Generate with AI</>
                    }
                  </button>
                )}
              </div>
              <textarea id="template-editor-description"
                className={`w-full p-3 border bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm h-24 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all outline-none resize-none placeholder:text-slate-400 dark:placeholder:text-slate-500 ${
                  formData.kind === 'skill' && !formData.description.trim()
                    ? 'border-amber-300 dark:border-amber-600'
                    : 'border-slate-200 dark:border-slate-600'
                }`}
                value={formData.description}
                onChange={e => { setFormData(prev => ({ ...prev, description: e.target.value })); setIsDirty(true); }}
                placeholder={formData.kind === 'skill' ? 'Describe when and how to use this skill — AI agents use this for discovery...' : 'Describe what this playbook does...'}
                readOnly={!canEdit}
              />
              {formData.kind === 'skill' && !formData.description.trim() && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  Description needed for AI agent discovery
                </p>
              )}
              {formData.kind === 'skill' && formData.description.trim() && (
                <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">AI agents use this description to decide when to apply this skill</p>
              )}

              {/* Tag — workspace templates only */}
              {!isLibrary && (
                <div className="mt-3">
                  <p className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tag</p>
                  <TagPicker
                    value={formData.tag ?? null}
                    tags={workspace.tags}
                    onChange={setTag}
                    onCreate={handleCreateTag}
                    disabled={!canEdit}
                  />
                </div>
              )}
            </div>

            {/* Category — marketplace templates only */}
            {isLibrary && (
              <div>
                <label htmlFor="template-editor-category" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Category</label>
                <div className="relative">
                  <select id="template-editor-category"
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none appearance-none"
                    value={libraryCategory}
                    onChange={e => { setLibraryCategory(e.target.value as TemplateCategory); setIsDirty(true); }}
                    disabled={!canEdit}
                  >
                    {TEMPLATE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Status — marketplace listings only (SQEM-204 named it, SQEM-210 narrowed it).
                For workspace templates this was a second, competing answer to "who may see this":
                "Draft — only editors & admins see it" sat directly above an Access control that
                answered the same question, and the two could contradict each other on screen. Access
                now owns it end to end — "Only me" says what Draft was reaching for, and says it in
                the one place that governs it. The migration carried existing drafts across as
                no-grantee access rows, so nothing became visible that was not before.
                Here it stays, because `library_templates.published` is a different column on a
                different table and means something else entirely: listed in the marketplace or not. */}
            {isLibrary && canEdit && (
              <div>
                <p className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Status</p>
                <button
                  onClick={() => { setFormData(prev => ({ ...prev, published: !prev.published })); setIsDirty(true); }}
                  aria-pressed={formData.published}
                  className={`w-full p-3 rounded-xl text-sm font-medium flex items-center justify-between gap-3 border transition-all ${
                    formData.published
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}
                >
                  <span className="flex items-center gap-2 shrink-0">
                    {formData.published ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    {formData.published ? 'Listed' : 'Draft'}
                  </span>
                  <span className="text-xs opacity-70 text-right">
                    {formData.published ? 'Shown in the marketplace' : 'Not listed yet — only admins see it'}
                  </span>
                </button>
              </div>
            )}

            {/* Access (SQEM-142) — workspace templates only; Cloud-only feature (SQEM-170).
                `allowPrivate` only here: as a workspace *default* (Settings) "Only me" would mean
                every new template starts invisible to the team (SQEM-210).

                SQEM-240 — a template with no owner cannot be made private: `can_access_template`
                matches the creator by id, and NULL matches nobody, so "Only me" would hide it from
                everyone including whoever picked it. Templates created over MCP before SQEM-240
                carry this; 47 of 82 on production did. */}
            {/* SQEM-314 — and on Solo it is not shown at all: one seat, nobody to grant to, so the
                question does not arise. ⛔ `accessAppliesTo` keeps it visible when the template
                already carries rules — a workspace downgraded from Team keeps its restricted
                templates, and hiding the control would leave the owner locked out of his own
                template with nothing on screen explaining it. */}
            {!isLibrary && canEdit && !IS_SELF_HOSTED && accessAppliesTo(workspace, access.mode !== 'everyone' || legacyRoles.length > 0) && (
              <TemplateAccessControl
                value={access}
                onChange={v => { setAccess(v); setIsDirty(true); }}
                members={workspace?.members}
                groups={groups}
                /* SQEM-300 — the owner is not offered in the people list: `can_access_template`
                   grants them access by `created_by` before any rule is read, so the tick would be
                   one that cannot be un-ticked. Empty while a template is still loading, which is
                   the safe direction — nobody is filtered and the list stays complete. */
                ownerId={formData.createdBy || null}
                /* SQEM-292 — the "create your first group" link is only offered to admins: RLS
                   rejects the write from anyone else, and a button that fails is worse than its
                   absence. Editors get the reason instead. */
                onCreateGroup={currentUser?.role === 'admin' ? () => navigate('/settings', { state: { initialTab: 'security' } }) : undefined}
                allowPrivate
                /* SQEM-314 — offer "Restrict access" on a multi-seat plan even while nobody else has
                   joined yet; that absence is a matter of time, not a reason to withhold it. */
                multiSeat={isMultiSeat(workspace)}
                legacyRoles={legacyRoles}
                privateDisabledReason={
                  id && !formData.createdBy
                    ? 'Unavailable — this playbook has no owner recorded, so "only me" would hide it from everyone'
                    : undefined
                }
              />
            )}

            {/* SQEM-473 — who may CHANGE it. Same control as Access, in its edit variant; set only by the
                owner or an admin, shown read-only to every other editor so they know whom to ask. */}
            {!isLibrary && canEdit && !IS_SELF_HOSTED && accessAppliesTo(workspace, editors.mode !== 'everyone') && (
              <TemplateAccessControl
                variant="edit"
                label="Who can edit"
                hint="Who may change this playbook. Everyone who can see it can still use it."
                value={editors}
                onChange={v => { setEditorsValue(v); setEditorsDirty(true); setIsDirty(true); }}
                members={workspace?.members}
                groups={groups}
                ownerId={formData.createdBy || null}
                multiSeat={isMultiSeat(workspace)}
                readOnly={!canManageEditors}
                readOnlyReason="Only the owner or a workspace admin can change who may edit this playbook."
              />
            )}

            {/* SQEM-323 — what the Cloud control would have said, in one line, for self-host.
                The block above is `!IS_SELF_HOSTED`, so until now this spot was simply **empty** —
                and an empty spot states nothing: somebody editing a template on a self-hosted
                instance had no way to learn who can open it. The answer is always "everyone in the
                workspace", precisely because the control that writes `template_access` rows is the
                one being hidden.

                ⚠️ A line, not a card. This is an editor sidebar next to the Save button; a gradient
                upsell box here would sell at the moment somebody is trying to work. The Cloud offer
                belongs in Settings (see the CTA there) — this only has to be true. */}
            {!isLibrary && canEdit && IS_SELF_HOSTED && (
              <div>
                <p className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Access</p>
                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40 px-3 py-2.5">
                  <Users className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">Everyone in this workspace</span>{' '}
                    can see and use this playbook. Restricting one to people or groups is available on{' '}
                    <a href="https://sqemes.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">sqemes Cloud</a>.
                  </p>
                </div>
              </div>
            )}

            {/* Context Files — workspace templates only */}
            {!isLibrary && (
              <div>
                <div className="flex items-center gap-1.5 mb-3">
                  <p className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Context Files</p>
                  <FieldTooltip text="Workspace files attached to this playbook. Their content is prepended as context when the playbook runs." />
                </div>
                <ContextFilePicker
                  selectedIds={formData.contextFileIds}
                  onChange={ids => { setFormData(prev => ({ ...prev, contextFileIds: ids })); setIsDirty(true); }}
                  files={workspaceFiles}
                  disabled={!canEdit}
                  onUploadClick={() => setUploadOpen(true)}
                />
              </div>
            )}

            {/* SQEM-167/298 — skills are applied directly (extension / Chat / MCP), never embedded
                into prompts (or the then-assistants). SQEM-167 removed the picker; SQEM-298 removed everything
                behind it, so there is no longer a legacy read to preserve either. */}

            {/* Variables — prompt kind only */}
            {formData.kind === 'prompt' && <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <p className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Variables</p>
                  <FieldTooltip text="Dynamic placeholders filled in at run time. Use {{variable_name}} in your prompt to insert them." />
                </div>
                {canEdit && (
                  <button onClick={openNewVariableModal} aria-label="Add variable" className="p-1 text-brand-600 hover:bg-brand-50 rounded transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {formData.variables.map((v, vi) => (
                  <div
                    key={v.id}
                    draggable={canEdit}
                    onDragStart={e => handleVarDragStart(e, v.id)}
                    onDragOver={e => handleVarDragOver(e, v.id)}
                    onDrop={e => handleVarDrop(e, v.id)}
                    onDragEnd={handleVarDragEnd}
                    className={`group bg-white dark:bg-slate-700 p-3 rounded-xl border shadow-sm transition-colors ${dragOverVarId === v.id ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-600'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        {canEdit && <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 cursor-grab active:cursor-grabbing" />}
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{v.label}</span>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1 reveal-on-hover transition-opacity">
                          <MoveButtons label={v.label || v.name} index={vi} count={formData.variables.length} onMove={to => moveVariable(vi, to)} />
                          <button onClick={e => { e.stopPropagation(); openEditVariable(v); }} aria-label={`Edit variable ${v.name}`} className="text-slate-400 hover:text-brand-600 p-1.5"><Edit className="w-3 h-3" /></button>
                          <button onClick={e => { e.stopPropagation(); setFormData(prev => ({ ...prev, variables: prev.variables.filter(x => x.id !== v.id) })); setIsDirty(true); }} aria-label={`Delete variable ${v.name}`} className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-2xs text-slate-400 font-mono bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-600 truncate flex-1" title={`{{${v.name}}}`}>{`{{${v.name}}}`}</code>
                      {canEdit && (
                        <button
                          onClick={() => { insertVariableToken(v.name); setMobileTab('editor'); }}
                          className="flex items-center gap-1.5 text-2xs font-bold text-brand-600 bg-white px-2 py-1.5 rounded-lg border border-brand-200 shadow-sm hover:bg-brand-50 hover:border-brand-300 transition-all whitespace-nowrap"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {formData.variables.length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl">
                    <p className="text-xs text-slate-400">No variables defined.</p>
                  </div>
                )}
              </div>
            </div>}

            {/* Owner (SQEM-241) — last in the column, because it is the one thing here that is not a
                setting: nothing about it is edited on this page. It answers "whose is this", which is
                also why "Only me" can be unavailable (SQEM-240).

                Rendered with the same `PersonCard` as the sidebar's profile row, so a change to how a
                person looks happens once. The two unknown states are deliberately NOT PersonCards —
                they are not people, and giving them an avatar with initials from "None recorded"
                would dress up an absence as somebody. */}
            {!isLibrary && id && (
              <div>
                <p className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Owner</p>
                {owner ? (
                  <PersonCard
                    name={owner.name || owner.email}
                    subtitle={owner.name ? owner.email : undefined}
                    avatar={owner.avatar}
                    role={owner.role}
                  />
                ) : (
                  <div className="flex items-start gap-3 px-3 py-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                    <UserRound className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {formData.createdBy ? 'No longer in this workspace' : 'None recorded'}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {formData.createdBy
                          ? 'The playbook stays where it is'
                          : '“Only me” needs an owner to mean anything'}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Center: Editor + optional Test Panel.
            SQEM-387 (follow-up) — hidden on phones while the Settings tab is up: its children were
            already hidden, but the wrapper stayed as an empty `flex-1` sibling of the settings rail
            (itself `flex-1` since SQEM-387) and took half the height — the owner saw a rail that
            "does not have 100% height". */}
        <div className={`flex-1 overflow-hidden min-w-0 ${mobileTab === 'settings' ? 'hidden xl:flex' : 'flex'}`}>

        {/* Editor column */}
        <div className={`flex flex-col bg-surface overflow-hidden relative flex-1 min-w-0 ${mobileTab === 'test' ? 'hidden' : mobileTab === 'editor' ? 'flex' : 'hidden xl:flex'}`}>
          {/* SQEM-550 (c) — redesign C: the title heads the document in the display face, with the kind
              above it, instead of being the first field of the settings rail. */}
          <div className="px-6 md:px-10 pt-6 pb-4 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <KindBadge kind={formData.kind} />
              {formData.tag && <span className="text-2xs font-bold uppercase tracking-wider px-2 py-1 rounded-chip bg-surface-sunken text-ink-muted">{formData.tag}</span>}
            </div>
            <label htmlFor="template-editor-title" className="sr-only">Title</label>
            <input id="template-editor-title"
              className="w-full bg-transparent font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-strong outline-none placeholder:text-ink-subtle"
              value={formData.title}
              onChange={e => { setFormData(prev => ({ ...prev, title: e.target.value })); setIsDirty(true); }}
              placeholder="Untitled"
              readOnly={!canEdit}
            />
          </div>

          {/* Warning banner for prompts that had multiple steps */}
          {formData.hadMultipleSteps && (
            <div className="flex items-center gap-2 px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 text-sm text-amber-700 dark:text-amber-400 shrink-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              This prompt had multiple steps. Only the first step was kept — please review and update the content.
            </div>
          )}

          {/* SQEM-390 — the assistant section (Brand Voice Builder / raw system instruction) sat here.
              Both kinds that remain write their body into the one content field below. */}
          {/* Toolbar + content textarea */}
          <div className="flex items-center justify-between px-6 md:px-10 py-2 shrink-0">
            <span className="text-2xs font-bold text-ink-subtle uppercase tracking-wider">
              {formData.kind === 'skill' ? 'Skill Content' : 'Prompt Content'}
            </span>
            {canEdit && (
              <button
                onClick={handleEnhance}
                disabled={isEnhancing}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isEnhancing ? <><Loader2 className="w-3 h-3 animate-spin" />Enhancing...</> : <><Sparkles className="w-3 h-3" />Enhance with AI</>}
              </button>
            )}
          </div>
          <textarea
            ref={textareaRef}
            // SQEM-538 — the editor's main field has no visible label of its own.
            aria-label={formData.kind === 'skill' ? 'Skill content' : 'Prompt content'}
            value={formData.content}
            onChange={e => { setFormData(prev => ({ ...prev, content: e.target.value })); setIsDirty(true); }}
            placeholder={
              formData.kind === 'skill'
                ? 'Write the skill knowledge or context here...'
                : 'Write your prompt here. Use {{variable_name}} to insert variables.'
            }
            readOnly={!canEdit}
            className="flex-1 mx-4 md:mx-8 mb-4 md:mb-6 p-5 md:p-6 rounded-card border border-line bg-surface-raised text-sm md:text-base text-ink resize-none outline-none leading-relaxed placeholder:text-ink-subtle focus:border-line-strong"
          />
        </div>

        {/* SQEM-477 — right panel: History and Test (Test was the only thing here before) */}
        {/* SQEM-387 — `flex-1 min-h-0` below `xl` (a column): `shrink-0` let this grow to its content and the shell cut it off; `xl:flex-none` keeps the width on xl. */}
        <div className={`w-full xl:w-[420px] flex-1 min-h-0 xl:flex-none overflow-hidden ${mobileTab === 'test' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col'}`}>
          {hasHistory && (
            <div role="tablist" className="flex border-b border-line bg-surface-raised shrink-0">
              {([['history', 'History', History], ['test', 'Test', FlaskConical]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={rightTab === key}
                  onClick={() => setRightTab(key)}
                  className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 border-b-2 ${rightTab === key ? 'text-ink-strong border-accent' : 'text-ink-muted border-transparent hover:text-ink-strong'}`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
          )}
          {hasHistory && rightTab === 'history' ? (
            <VersionHistoryPanel
              templateId={id!}
              canEdit={canEdit}
              members={workspace?.members ?? []}
              refreshKey={historyKey}
              isDirty={isDirty}
              onRestored={handleRestored}
              onError={msg => showToast(msg, 'error')}
            />
          ) : (
            // Kept mounted only while visible, as before: switching to History ends the test chat.
            <EditorTestPanel
              template={{
                kind: formData.kind,
                title: formData.title,
                content: formData.content ?? '',
                variables: formData.variables ?? [],
                contextFileIds: formData.contextFileIds ?? [],
              }}
              resetKey={testResetKey}
              onReset={() => setTestResetKey(k => k + 1)}
            />
          )}
        </div>

        </div>{/* end center+test wrapper */}
      </div>

      {/* Variable Modal */}
      <Modal open={showVarModal} onClose={() => setShowVarModal(false)} size="md" className="p-6 md:p-8 overflow-y-auto max-h-[90vh]">
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-6">{editingVarId ? 'Edit Variable' : 'Add Variable'}</h3>
        <div className="space-y-5">
          <div>
            <label htmlFor="template-editor-name-id" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Name (ID)</label>
            <input id="template-editor-name-id"
              className={`w-full p-3 border rounded-xl text-sm outline-none focus:border-brand-500 transition-colors bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 ${varNameError ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`}
              placeholder="e.g. product_name"
              value={newVar.name || ''}
              onChange={e => { setNewVar(v => ({ ...v, name: e.target.value })); setVarNameError(null); }}
              disabled={!!editingVarId}
            />
            {varNameError && <p className="text-xs text-red-500 mt-1">{varNameError}</p>}
          </div>
          <div>
            <label htmlFor="template-editor-label" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Label</label>
            <input id="template-editor-label" className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:border-brand-500 transition-colors bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" placeholder="e.g. Product Name" value={newVar.label || ''} onChange={e => setNewVar(v => ({ ...v, label: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="template-editor-type" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Type</label>
            <select id="template-editor-type" className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-700 dark:text-slate-100 outline-none focus:border-brand-500 transition-colors" value={newVar.type} onChange={e => setNewVar(v => ({ ...v, type: e.target.value as VariableType }))}>
              <option value="text">Text Input</option>
              <option value="textarea">Text Area</option>
              <option value="select">Dropdown Select</option>
              <option value="file">File Upload</option>
            </select>
          </div>
          {newVar.type === 'select' && (
            <div>
              <label htmlFor="template-editor-options-comma-separated" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Options (comma separated)</label>
              <input id="template-editor-options-comma-separated" className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:border-brand-500 transition-colors bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" placeholder="Option A, Option B" value={varOptionsString} onChange={e => setVarOptionsString(e.target.value)} />
            </div>
          )}
          {newVar.type !== 'file' && (
            <div>
              <label htmlFor="template-editor-default-value" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Default Value</label>
              <input id="template-editor-default-value" className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:border-brand-500 transition-colors bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500" value={newVar.defaultValue || ''} onChange={e => setNewVar(v => ({ ...v, defaultValue: e.target.value }))} />
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={() => setShowVarModal(false)} className="flex-1 px-4 py-3 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 font-medium transition-colors">Cancel</button>
          <Button onClick={saveVariable} className="flex-1 px-4 py-3 shadow-lg shadow-brand-200">{editingVarId ? 'Update' : 'Add'} Variable</Button>
        </div>
      </Modal>

      {/* Discard Changes Modal */}
      <Modal open={showDiscardModal} onClose={() => setShowDiscardModal(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Unsaved Changes</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">You have unsaved changes. Are you sure you want to leave without saving?</p>
        <div className="flex gap-2">
          <button onClick={() => setShowDiscardModal(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Keep Editing</button>
          <Button variant="danger" onClick={() => navigate(listPath)} className="flex-1 py-2.5 text-xs shadow-lg hover:shadow-red-200">Discard</Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Delete Playbook?</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Are you sure you want to delete this playbook? This action cannot be undone.</p>
        <div className="flex gap-2">
          <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
          <Button variant="danger" onClick={confirmDelete} className="flex-1 py-2.5 text-xs shadow-lg hover:shadow-red-200">Yes, Delete</Button>
        </div>
      </Modal>

      {/* Upload Context File Modal */}
      {uploadOpen && (
        <UploadFileModal
          workspaceId={workspace.id}
          onClose={() => setUploadOpen(false)}
          onUploaded={handleUploaded}
        />
      )}
    </div>
  );
};

export default TemplateEditor;
