// SQEM-324 — the Persona editor.
//
// Two halves, and the split is the feature: on the left the ORCHESTRATOR PROSE (who this role is,
// how it works), on the right the ROUTES (which template, under which condition). They are stored
// apart — see the migration header — so that deleting a template cannot leave a dead route inside a
// paragraph, and so "Enhance with AI" can rewrite the prose without ever touching the routing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Save, Trash2, Plus, GripVertical, Sparkles, Loader2, X, AlertTriangle,
  Settings, PenTool, ListTree, Search, Wand2, UserRound, Lock,
  Bot,
} from 'lucide-react';
import { useWorkspace, useUI, usePrompts } from '../store';
import { TagPicker } from '../components/TagPicker';
import { can } from '../lib/permissions';
import { runAuthoringAI, authoringModelId } from '../lib/authoringAI';
import { enhancePrompt, enhanceInput, describePrompt } from '../supabase/functions/_shared/authoringPrompts.ts';
import {
  fetchPersona, createPersona, updatePersona, setPersonaRoutes, deletePersona,
} from '../lib/api/personas';
import type { PersonaRoute, Prompt, PromptKind } from '../types';
import FullScreenExit from '../components/ui/FullScreenExit';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import PersonCard from '../components/ui/PersonCard';
import MoveButtons from '../components/ui/MoveButtons';
import { moveItem } from '../lib/moveItem';
import Button from '../components/ui/Button';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import KindBadge from '../components/ui/KindBadge';
import TemplatePickRow from '../components/ui/TemplatePickRow';
import { IS_SELF_HOSTED } from '../lib/env';
import {
  TemplateAccessControl, seedFromWorkspaceDefault, type TemplateAccessValue,
} from '../components/TemplateAccessControl';
import { accessAppliesTo, isMultiSeat } from '../lib/templateAccessScope';
import { fetchGroups } from '../lib/api/groups';
import { fetchEditors, setEditors, fetchEditRights } from '../lib/api/editors';
import {
  fetchPersonaAccess, setPersonaAccess, accessValueToPersonaAccess, personaAccessToValue,
  fetchRestrictedTemplateIdsAmong,
} from '../lib/api/personaAccess';
import { ACCESS_BADGE_LABEL, type AccessBadgeMode } from '../lib/accessBadge';
import { Textarea } from '../components/ui/Input';
import { m } from '../lib/i18n';

export default function PersonaEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { workspace, currentUser, updateWorkspace } = useWorkspace();
  const { showToast } = useUI();
  const { prompts } = usePrompts();

  // SQEM-473 — role AND this persona's edit right; every control below keys on `canEdit`, so a persona
  // someone may use but not change opens read-only.
  const roleCanEdit = can(currentUser, workspace, 'prompts:edit');
  const [editRight, setEditRight] = useState(true);
  const [canManageEditors, setCanManageEditors] = useState(!id);
  // SQEM-534 — a NEW one starts as the workspace default says; the database writes the same restriction
  // on insert, so this only shows it (and lets the creator open it again before the first save).
  const [editors, setEditorsValue] = useState<TemplateAccessValue>(() => ({
    mode: !id && workspace?.defaultEditRestricted ? 'restricted' : 'everyone', userIds: [], groupIds: [],
  }));
  const [editorsDirty, setEditorsDirty] = useState(false);
  const canEdit = roleCanEdit && editRight;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // SQEM-393 — one tag in the UI, stored as `tags: [tag]`: the column is an array (SQEM-324) and
  // the bundle format carries it, so nothing below the editor changes.
  const [tag, setTag] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [routes, setRoutes] = useState<PersonaRoute[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [conditioning, setConditioning] = useState<string | null>(null);
  // SQEM-326 — the persona's own access, and the workspace's groups to offer in it. New personas
  // follow the workspace's "new templates start restricted" default: it expresses a preference
  // about the workspace, not a fact about templates, so a second setting would be a second place to
  // maintain the same intent.
  const [access, setAccess] = useState<TemplateAccessValue>(
    () => seedFromWorkspaceDefault(workspace?.defaultTemplateAccess ?? []),
  );
  const [groups, setGroups] = useState<{ id: string; name: string; memberIds: string[] }[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [restrictedRouteIds, setRestrictedRouteIds] = useState<Map<string, AccessBadgeMode>>(new Map()); // SQEM-400 — the word per route
  const [mobileTab, setMobileTab] = useState<'details' | 'role' | 'routes'>('role');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [pickKind, setPickKind] = useState<'all' | PromptKind>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const persona = await fetchPersona(id);
        if (cancelled) return;
        if (!persona) {
          showToast(m.pe_not_found(), 'error');
          navigate('/personas');
          return;
        }
        setTitle(persona.title);
        setDescription(persona.description);
        setTag(persona.tags[0] ?? null);
        setContent(persona.content);
        setRoutes(persona.routes);
        setOwnerId(persona.createdBy || null);
        // SQEM-326 — read the rules before the control renders, so it never shows "everyone" for a
        // persona that is restricted. Failure is deliberately loud here: silently showing the wrong
        // access is the failure this whole area keeps recording.
        if (!IS_SELF_HOSTED) {
          try {
            setAccess(personaAccessToValue(await fetchPersonaAccess(persona.id)));
          } catch (err: any) {
            showToast(err?.message || m.pe_access_read_failed(), 'error');
          }
          // SQEM-473 — who may change it, and whether this person may.
          try {
            const e = await fetchEditors('persona', persona.id);
            setEditorsValue({ mode: e.userIds.length || e.groupIds.length ? 'restricted' : 'everyone', userIds: e.userIds, groupIds: e.groupIds });
            const r = await fetchEditRights('persona', persona.id);
            setEditRight(r.canEdit); setCanManageEditors(r.canManage);
          } catch { /* the editor stays editable; RLS still refuses a write that is not allowed */ }
        }
      } catch (err: any) {
        if (!cancelled) showToast(err?.message || m.pe_load_failed(), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // SQEM-326 — the groups the access control offers. Silent on failure by design: the People tab
  // still works, and a toast about groups while somebody is writing a persona is noise.
  useEffect(() => {
    if (IS_SELF_HOSTED || !workspace?.id) return;
    fetchGroups(workspace.id)
      .then(gs => setGroups(gs.map(g => ({ id: g.id, name: g.name, memberIds: g.memberIds }))))
      .catch(() => {});
  }, [workspace?.id]);

  // SQEM-326 — which attached templates carry a rule, so the warning below can name them. Runs on
  // every route change because attaching a restricted template is exactly the moment the author
  // should learn what it means.
  useEffect(() => {
    if (IS_SELF_HOSTED || !workspace?.id || routes.length === 0) { setRestrictedRouteIds(new Map()); return; }
    let cancelled = false;
    fetchRestrictedTemplateIdsAmong(workspace.id, routes.map(r => r.templateId))
      .then(ids => { if (!cancelled) setRestrictedRouteIds(ids); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspace?.id, routes]);

  // SQEM-330 — the owner, resolved against the current member list. Undefined means either "never
  // recorded" or "no longer here", and the two are told apart by whether `ownerId` is set at all.
  const owner = useMemo(
    () => (workspace?.members ?? []).find(member => member.id === ownerId),
    [workspace?.members, ownerId],
  );

  const attachedIds = useMemo(() => new Set(routes.map(r => r.templateId)), [routes]);

  // The templates are already in the store; a route only stores the id, so this is where a route
  // finds the description it falls back to.
  const templateById = useMemo(
    () => new Map(prompts.map(p => [p.id, p])),
    [prompts],
  );

  const pickable = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    return prompts
      .filter(p => !attachedIds.has(p.id))
      .filter(p => pickKind === 'all' || p.kind === pickKind)
      .filter(p => !q || p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [prompts, attachedIds, pickSearch, pickKind]);

  const attach = (template: Prompt) => {
    setRoutes(prev => [...prev, {
      templateId: template.id,
      templateTitle: template.title,
      templateKind: template.kind,
      condition: '',
      sortOrder: prev.length,
    }]);
    setIsDirty(true);
  };

  const removeRoute = (templateId: string) => {
    setRoutes(prev => prev.filter(r => r.templateId !== templateId));
    setIsDirty(true);
  };

  const setCondition = (templateId: string, condition: string) => {
    setRoutes(prev => prev.map(r => r.templateId === templateId ? { ...r, condition } : r));
    setIsDirty(true);
  };

  // Native HTML5 drag and drop, like every other reorderable list in this app. No DnD library:
  // the project ships no UI component library at all, and one list is not the reason to start.
  const onDrop = (target: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === target) return;
    moveRoute(from, target);
  };
  // SQEM-540 — shared by drag-and-drop and the Move up / Move down buttons.
  const moveRoute = (from: number, to: number) => {
    setRoutes(prev => moveItem(prev, from, to).map((r, i) => ({ ...r, sortOrder: i })));
    setIsDirty(true);
  };

  /**
   * Enhance the prose — and only the prose.
   *
   * ⚠️ The attached routes go into the prompt as CONTEXT, never as something to rewrite. A model
   * told "here is a persona, improve it" will happily invent a route table in the text, which is
   * precisely the duplication the data model was shaped to prevent. So the instruction says what it
   * may write and the conditions stay where they are: in the fields on the right.
   */
  const handleEnhance = async () => {
    if (!content.trim()) {
      showToast(m.pe_enhance_empty(), 'error');
      return;
    }
    setEnhancing(true);
    try {
      const routeSummary = routes
        .map(r => `- ${r.templateTitle || 'Untitled'}${r.condition ? `: ${r.condition}` : ''}`)
        .join('\n');

      // SQEM-390 — the persona text lives in the shared authoring module now, unchanged; the routes
      // stay context only (the module's text forbids a routing table — see SQEM-324).
      const enhanced = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId: authoringModelId(workspace),
        systemInstruction: enhancePrompt('persona', { routeSummary }),
        prompt: enhanceInput('persona', content.trim()),
      });
      if (enhanced) {
        setContent(enhanced);
        setIsDirty(true);
        showToast(m.pe_enhanced(), 'success');
      }
    } catch (err: any) {
      showToast(err?.message || m.pe_enhance_failed(), 'error');
    } finally {
      setEnhancing(false);
    }
  };

  /**
   * Write the description an MCP client shows in its picker.
   *
   * ⚠️ It is aimed at a **decision**, not at a summary. This line is often all a person or a model
   * sees before choosing a persona, so it has to answer "is this the right role for what I am about
   * to do?" — which is a different sentence from "what is this persona about".
   */
  const handleGenerateDescription = async () => {
    if (!content.trim() && routes.length === 0) {
      showToast(m.pe_describe_empty(), 'error');
      return;
    }
    setDescribing(true);
    try {
      const routeSummary = routes
        .map(r => {
          const tpl = templateById.get(r.templateId);
          return `- ${r.templateTitle || tpl?.title || 'Untitled'}: ${r.condition || tpl?.description || ''}`;
        })
        .join('\n');

      const generated = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId: authoringModelId(workspace),
        systemInstruction: describePrompt('persona'), // SQEM-390 — text unchanged, one home
        prompt: `Persona name: ${title || '(unnamed)'}\n\nRole description:\n${content.trim() || '(empty)'}\n\nAttached playbooks:\n${routeSummary || '(none)'}`,
      });
      if (generated) {
        setDescription(generated.trim());
        setIsDirty(true);
      }
    } catch (err: any) {
      showToast(err?.message || m.pe_describe_failed(), 'error');
    } finally {
      setDescribing(false);
    }
  };

  /**
   * Write one route's condition — only ever as an OVERRIDE.
   *
   * ⛔ It is not offered as a step everybody walks through. An empty condition already falls back to
   * the template's live description, which is right for most routes; generating one would replace a
   * value that stays current with a copy that goes stale. This exists for the case the fallback
   * cannot cover: the same template meaning different things in different personas.
   */
  const handleGenerateCondition = async (route: PersonaRoute) => {
    const tpl = templateById.get(route.templateId);
    setConditioning(route.templateId);
    try {
      const systemInstruction = `You write the ROUTING CONDITION for one template inside a persona.

The condition completes the sentence "load this playbook when …". It is read by an AI assistant that has adopted the persona and must decide, mid-conversation, whether this template applies.

Rules:
- One short clause. No sentence case ceremony, no "when the user" preamble if it can be dropped.
- Say the SITUATION, not what the template contains.
- The template's own description is the default when no condition is written, so a condition that merely restates it is worthless. Write what this template means **for this persona specifically**.
- Output only the clause.`;

      const generated = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId: authoringModelId(workspace),
        systemInstruction,
        prompt: `Persona: ${title || '(unnamed)'}\nRole:\n${content.trim() || '(empty)'}\n\nTemplate: ${tpl?.title || route.templateTitle}\nIts description: ${tpl?.description || '(none)'}`,
      });
      if (generated) setCondition(route.templateId, generated.trim().replace(/^["']|["']$/g, ''));
    } catch (err: any) {
      showToast(err?.message || m.pe_condition_failed(), 'error');
    } finally {
      setConditioning(null);
    }
  };

  // SQEM-473 — the editor list, only by its owner or an admin. ⛔ "Only selected people" with nobody
  // ticked writes the owner as the single editor: no row would mean "no restriction".
  const saveEditors = async (personaId: string, owner: string | null) => {
    if (!canManageEditors || !editorsDirty) return;
    try {
      const named = { userIds: editors.userIds, groupIds: editors.groupIds ?? [] };
      if (editors.mode === 'restricted' && named.userIds.length === 0 && named.groupIds.length === 0) {
        named.userIds = [owner || currentUser.id];
      }
      await setEditors('persona', personaId, workspace.id, editors.mode === 'restricted' ? named : { userIds: [], groupIds: [] });
      setEditorsDirty(false);
    } catch {
      showToast(m.ed_editors_failed(), 'error');
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showToast(m.pe_name_needed(), 'error');
      return;
    }
    setSaving(true);
    try {
      if (id) {
        await updatePersona(id, { title: title.trim(), description: description.trim(), content, tags: tag ? [tag] : [] });
        await setPersonaRoutes(id, routes);
        if (!IS_SELF_HOSTED) {
          await setPersonaAccess(id, workspace.id, accessValueToPersonaAccess(access, ownerId));
          await saveEditors(id, ownerId);
        }
      } else {
        const created = await createPersona(
          workspace.id,
          { title: title.trim(), description: description.trim(), content, routes, tags: tag ? [tag] : [] },
          currentUser.id || null,
        );
        // ⚠️ Access is written AFTER the persona exists, so a failure here leaves a persona that is
        // open when it was meant to be restricted. That is the wrong direction, so it is not left
        // to chance: the failure is reported rather than swallowed, and the person is already on the
        // editor for the persona in question and can press Save again.
        if (!IS_SELF_HOSTED) {
          try {
            await setPersonaAccess(created.id, workspace.id, accessValueToPersonaAccess(access, currentUser.id || null));
          } catch (accessErr: any) {
            showToast(
              m.pe_access_not_applied({ detail: accessErr?.message ?? '' }).trim(),
              'error',
            );
          }
        }
        if (!IS_SELF_HOSTED) await saveEditors(created.id, currentUser.id || null);
        navigate(`/personas/${created.id}/edit`, { replace: true });
      }
      setIsDirty(false);
      showToast(m.pe_saved(), 'success');
    } catch (err: any) {
      showToast(err?.message || m.pe_save_failed(), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deletePersona(id);
      showToast(m.pe_deleted(), 'success');
      navigate('/personas');
    } catch (err: any) {
      showToast(err?.message || m.pe_delete_failed(), 'error');
    }
  };

  // SQEM-329 — the guard is a modal, not the browser's `confirm()`. FullScreenExit calls this on
  // its own click, so the check has to live here rather than inside the exit control.
  const handleBack = () => {
    if (isDirty) { setConfirmLeave(true); return; }
    navigate('/personas');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> {m.pe_loading()}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface overflow-hidden">
      <header className="bg-surface-raised border-b border-line h-16 px-4 md:px-6 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-2">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-8 h-8 rounded-lg shrink-0" />
          {/* SQEM-544 — the page's h1, for screen readers; the visible name is the field below. */}
          <h1 className="sr-only">{title || (id ? m.pe_edit_title() : m.pe_new_title())}</h1>
          <FullScreenExit label={m.pe_back()} onExit={handleBack} />
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {id && canEdit && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
              title={m.pe_delete()}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {canEdit && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {/* SQEM-539 — the same verbs as the playbook editor. */}
              {id ? m.ed_save_changes() : m.pe_create()}
            </Button>
          )}
        </div>
      </header>

      {/* SQEM-473 — may use, may not change: said once, with whom to ask. */}
      {id && roleCanEdit && !editRight && (
        <div className="flex items-start gap-2.5 border-b border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 px-4 md:px-6 py-2.5">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-semibold">{m.pe_readonly_1()}</span>{' '}
            {owner ? m.ed_readonly_2_named({ owner: owner.name || owner.email }) : m.ed_readonly_2()}
          </p>
        </div>
      )}

      {/* Mobile tab switcher — the three columns cannot sit side by side on a phone, and stacking
          them buries the routes under a long textarea. Same three-way switch as the template
          editor, so the two pages behave identically where it matters most. */}
      <div className="xl:hidden flex border-b border-line bg-surface-raised">
        {([
          { id: 'details' as const, label: m.pe_tab_details(), icon: <Settings className="w-4 h-4" /> },
          { id: 'role' as const, label: m.pe_tab_role(), icon: <PenTool className="w-4 h-4" /> },
          { id: 'routes' as const, label: m.pe_tab_playbooks(), icon: <ListTree className="w-4 h-4" /> },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setMobileTab(t.id)}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === t.id ? 'text-ink-strong border-b-2 border-accent' : 'text-ink-muted'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden relative">

        {/* ── Left: what the persona IS ─────────────────────────────────────
            Name, description and who may use it. Same width and tone as the template editor's
            settings rail, because it answers the same class of question: metadata about the thing,
            not the thing itself.
            SQEM-387 — `flex-1 min-h-0` below `xl` (a column there): with `shrink-0` the panel grew
            to its content and the parent's `overflow-hidden` cut it off — nothing to scroll. Same
            on the routes rail. On `xl` it is a row and `xl:flex-none` keeps the fixed width. */}
        <div className={`w-full xl:w-[340px] bg-surface-sunken/60 border-r border-line overflow-y-auto p-6 flex-1 min-h-0 xl:flex-none ${mobileTab === 'details' ? 'block' : 'hidden xl:block'}`}>
          <div className="space-y-8">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="persona-editor-description" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{m.ed_description()}</label>
                {canEdit && (
                  <button
                    onClick={handleGenerateDescription}
                    disabled={describing}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {describing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {m.pe_write_for_me()}
                  </button>
                )}
              </div>
              <Textarea id="persona-editor-description"
                value={description}
                onChange={e => { setDescription(e.target.value); setIsDirty(true); }}
                disabled={!canEdit}
                rows={3}
                placeholder={m.pe_description_placeholder()}
                className="resize-none"
              />
              <p className="text-2xs text-slate-400 mt-1.5">
                {m.pe_description_hint()} <span className="italic">{m.pe_description_hint_question()}</span>
              </p>
            </div>

            {/* SQEM-393 — the same picker and the same registry as the playbook editor: one tag, from
                `workspace.tags`, a new one added to the registry on the spot. */}
            <div>
              <p className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{m.ed_tag()}</p>
              <TagPicker
                value={tag}
                tags={workspace.tags}
                onChange={t => { setTag(t); setIsDirty(true); }}
                onCreate={name => {
                  const created = name.trim();
                  if (!created) return;
                  if (!workspace.tags.includes(created)) updateWorkspace({ tags: [...workspace.tags, created] });
                  setTag(created);
                  setIsDirty(true);
                }}
                disabled={!canEdit}
              />
            </div>

            {/* SQEM-326 — who may use the persona. Cloud-only, like every other access surface
                (SQEM-170/323): on self-host nothing is rendered here at all, rather than a box
                explaining a feature that instance does not have. */}
            {!IS_SELF_HOSTED && canEdit && accessAppliesTo(workspace, access.mode !== 'everyone') && (
              <TemplateAccessControl
                value={access}
                onChange={v => { setAccess(v); setIsDirty(true); }}
                label={m.ta_label()}
                hint={m.pe_access_hint()}
                members={workspace?.members}
                groups={groups}
                onCreateGroup={currentUser?.role === 'admin'
                  ? () => navigate('/settings', { state: { initialTab: 'security' } }) // SQEM-480 — groups live there now
                  : undefined}
                allowPrivate
                multiSeat={isMultiSeat(workspace)}
                ownerId={ownerId || (id ? null : currentUser.id)}
                /* SQEM-330, mirroring SQEM-240 on templates — with no `created_by`,
                   `can_access_persona()` matches nobody, so "Only me" would hide the persona from
                   everyone including whoever picked it. Shown with its reason rather than quietly
                   missing: a control that silently lacks an option teaches nothing. */
                privateDisabledReason={
                  id && !ownerId
                    ? m.pe_only_me_unavailable()
                    : undefined
                }
              />
            )}

            {/* SQEM-473 — who may CHANGE it; set by the owner or an admin, read-only for everyone else. */}
            {!IS_SELF_HOSTED && canEdit && accessAppliesTo(workspace, editors.mode !== 'everyone') && (
              <TemplateAccessControl
                variant="edit"
                label={m.ed_who_can_edit()}
                hint={m.pe_who_can_edit_hint()}
                value={editors}
                onChange={v => { setEditorsValue(v); setEditorsDirty(true); setIsDirty(true); }}
                members={workspace?.members}
                groups={groups}
                ownerId={ownerId || (id ? null : currentUser.id)}
                multiSeat={isMultiSeat(workspace)}
                readOnly={!canManageEditors}
                readOnlyReason={m.pe_who_can_edit_readonly()}
              />
            )}

            {/* SQEM-330 — whose persona this is, **last in the rail**, exactly where the template
                editor puts it (Type · Title · Description · … · Access · Owner). It is the only
                block nobody edits, so it belongs below everything that is edited.
                SQEM-330 — whose persona this is. Not a setting: nothing about it is edited here. It
                answers "whose is this", which is also why "Only me" can be unavailable below.
                Rendered with the same `PersonCard` as the sidebar profile row and the template
                editor, so a change to how a person looks happens once. ⚠️ The two unknown states are
                deliberately NOT PersonCards — they are not people, and an avatar with initials from
                "None recorded" dresses up an absence as somebody. */}
            {id && (
              <div>
                <p className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{m.ed_owner()}</p>
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
                        {ownerId ? m.ed_owner_gone() : m.ed_owner_none()}
                      </span>
                      <span className="block text-2xs text-slate-400 dark:text-slate-500">
                        {ownerId
                          ? m.pe_owner_gone_hint()
                          : m.pe_owner_none_hint()}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Middle: the orchestrator prose ────────────────────────────────
            Full height, like the template editor's content column: this is the thing being
            written, and it gets the room. */}
        <div className={`flex flex-col bg-surface overflow-hidden flex-1 min-w-0 ${mobileTab === 'role' ? 'flex' : 'hidden xl:flex'}`}>
          {/* SQEM-550 (d) — redesign C: the persona's name heads the page in the display face, beside
              its mark — moved here from the details rail, as the playbook editor's title (c). */}
          <div className="px-6 md:px-10 pt-6 pb-4 shrink-0 flex items-center gap-4">
            <div aria-hidden className="w-12 h-12 md:w-14 md:h-14 rounded-card bg-accent-strong text-white flex items-center justify-center shrink-0">
              <Bot className="w-6 h-6 md:w-7 md:h-7" />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="persona-editor-name" className="sr-only">{m.pe_name_label()}</label>
              <input id="persona-editor-name"
                value={title}
                onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                disabled={!canEdit}
                placeholder={m.pe_name_placeholder()}
                className="w-full bg-transparent font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-strong outline-none placeholder:text-ink-subtle"
              />
              {description && <p className="text-sm text-ink-muted truncate">{description}</p>}
            </div>
          </div>
          <div className="flex items-center justify-between px-6 md:px-10 py-2 shrink-0">
            <label htmlFor="persona-editor-role-and-rules" className="block text-2xs font-bold text-ink-subtle uppercase tracking-wider">{m.pe_role_label()}</label>
            {canEdit && (
              <button
                onClick={handleEnhance}
                disabled={enhancing}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 disabled:opacity-50 transition-colors"
              >
                {enhancing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {m.ed_enhance()}
              </button>
            )}
          </div>
          <textarea id="persona-editor-role-and-rules"
            value={content}
            onChange={e => { setContent(e.target.value); setIsDirty(true); }}
            disabled={!canEdit}
            placeholder={m.pe_role_placeholder()}
            className="flex-1 mx-4 md:mx-8 p-5 md:p-6 rounded-card border border-line bg-surface-raised text-sm md:text-base text-ink resize-none outline-none leading-relaxed placeholder:text-ink-subtle focus:border-line-strong"
          />
          {/* ⚠️ Stated rather than left to be discovered: people will try to write the routing into
              this box, because that is how it reads once the client renders it. */}
          <p className="text-2xs text-ink-subtle px-6 md:px-10 py-2.5 shrink-0">
            {m.pe_role_hint()}
          </p>
        </div>

        {/* ── Right: the routes ─────────────────────────────────────────────
            Its own rail rather than a section under the prose: attaching a template and writing the
            role are two different activities, and the routes have to stay visible while the role is
            written — the role is *about* them. */}
        <div className={`w-full xl:w-[420px] bg-surface-sunken/60 border-l border-line overflow-y-auto p-6 flex-1 min-h-0 xl:flex-none ${mobileTab === 'routes' ? 'block' : 'hidden xl:block'}`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{m.pe_tab_playbooks()}</p>
              {canEdit && (
                <button
                  onClick={() => { setPickSearch(''); setPicking(true); }}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> {m.pe_attach()}
                </button>
              )}
            </div>
            <p className="text-2xs text-slate-400 dark:text-slate-500 -mt-2">
              {m.pe_route_hint_1()} <span className="font-semibold">{m.pe_route_hint_when()}</span> {m.pe_route_hint_2()}
            </p>

            {routes.length === 0 && (
              <div className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
                <p className="font-semibold text-slate-600 dark:text-slate-300">{m.pe_no_playbooks()}</p>
                <p className="mt-1">{m.pe_no_playbooks_body()}</p>
              </div>
            )}

            {/* SQEM-550 (d) — redesign C: each route reads as a step of a flow — "If {condition}" →
                "Load {playbook}" — instead of a card with the playbook on top and the condition below.
                Same fields, same order semantics (drag, MoveButtons), same fallback note. */}
            {routes.map((route, i) => (
              <div
                key={route.templateId}
                draggable={canEdit}
                onDragStart={() => { dragIndex.current = i; }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                className="relative"
              >
                <div className="rounded-card border border-line bg-surface-raised p-3">
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor={`persona-route-condition-${route.templateId}`} className="text-2xs font-bold text-ink-subtle uppercase tracking-wider">
                      {m.ppv_if()}
                    </label>
                    {canEdit && (
                      <button
                        onClick={() => handleGenerateCondition(route)}
                        disabled={conditioning === route.templateId}
                        className="flex items-center gap-1 text-2xs font-semibold text-accent hover:opacity-80 disabled:opacity-50 transition-opacity"
                        title={m.pe_write_condition_title()}
                      >
                        {conditioning === route.templateId
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Sparkles className="w-3 h-3" />}
                        {m.pe_write()}
                      </button>
                    )}
                  </div>
                  <input
                    id={`persona-route-condition-${route.templateId}`}
                    value={route.condition}
                    onChange={e => setCondition(route.templateId, e.target.value)}
                    disabled={!canEdit}
                    placeholder={templateById.get(route.templateId)?.description || m.pe_condition_placeholder()}
                    className="w-full px-2.5 py-2 text-sm rounded-control border border-line bg-surface-field text-ink outline-none focus:border-line-strong"
                  />
                  {/* ⛔ Empty is a normal, good state — not a warning. The fallback is the template's
                      own description, resolved when the persona is rendered so it never goes stale.
                      The override exists for the case that description cannot cover: the same
                      template meaning different things in two personas. */}
                  {!route.condition.trim() && (
                    <p className="text-2xs text-ink-subtle mt-1.5">
                      {templateById.get(route.templateId)?.description
                        ? <>{m.pe_fallback_a()} <span className="italic">{m.pe_fallback_em()}</span>{m.pe_fallback_b()}</>
                        : m.pe_no_description()}
                    </p>
                  )}
                </div>
                <div aria-hidden className="ml-6 h-3 border-l-2 border-accent" />
                <div className="rounded-card bg-accent-soft p-3 flex items-start gap-2">
                  {canEdit && <GripVertical className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5 cursor-grab" />}
                  <div className="min-w-0 flex-1">
                    <span className="block text-2xs font-bold text-accent uppercase tracking-wider">{m.pe_load()}</span>
                    <p className="text-sm font-semibold text-ink-strong truncate" title={route.templateTitle}>
                      {route.templateTitle || m.pe_untitled_playbook()}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {route.templateKind && <KindBadge kind={route.templateKind} />}
                      {!IS_SELF_HOSTED && restrictedRouteIds.has(route.templateId) && (
                        <span
                          className="text-2xs font-bold px-2 py-0.5 rounded-lg uppercase tracking-wider flex items-center gap-1 shrink-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                          title={restrictedRouteIds.get(route.templateId) === 'private'
                            ? m.pe_only_me_route()
                            : m.pe_restricted_route()}
                        >
                          <Lock className="w-3 h-3" /> {ACCESS_BADGE_LABEL[restrictedRouteIds.get(route.templateId) ?? 'restricted']}
                        </span>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <MoveButtons label={route.templateTitle || m.pe_playbook_word()} index={i} count={routes.length} onMove={to => moveRoute(i, to)} />
                  )}
                  {canEdit && (
                    <button
                      onClick={() => removeRoute(route.templateId)}
                      className="p-1.5 text-ink-subtle hover:text-danger transition-colors shrink-0"
                      title={m.pe_remove_route()}
                      aria-label={m.pe_remove_route_label({ title: route.templateTitle || m.pe_playbook_word() })}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {canEdit && routes.length > 0 && (
              <button
                type="button"
                onClick={() => { setPickSearch(''); setPicking(true); }}
                className="w-full flex items-center justify-center gap-1.5 py-3 rounded-card border-2 border-dashed border-line-strong text-sm font-semibold text-ink-muted hover:text-ink-strong hover:border-accent transition-colors"
              >
                <Plus className="w-4 h-4" /> {m.pe_add_condition()}
              </button>
            )}

            {/* ⛔ SQEM-326 — the sentence that stops this feature degrading in silence. A persona
                shared with the workspace may attach a template restricted to its author; colleagues
                then receive it **without** those routes: it works, it is quietly worse, and nobody
                can tell why. Filtering happens against the CALLER's rights, never the author's —
                attaching must never widen access — so the only honest fix is to say so here.

                SQEM-330 — moved out of the left rail and under the routes, where the rows it talks
                about are. In the metadata column it was a sentence about something the reader could
                not see while reading it.

                ⚠️ Rendered only when there is something to report. "All playbooks are open" is a
                sentence nobody needs, and a permanently visible box about access is how a warning
                stops being read. */}
            {!IS_SELF_HOSTED && restrictedRouteIds.size > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 mt-4">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="text-2xs text-amber-800 dark:text-amber-200">
                  <p className="font-semibold">
                    {(restrictedRouteIds.size === 1 ? m.pe_restricted_one : m.pe_restricted_other)({ restricted: restrictedRouteIds.size, playbooks: m.count_playbook({ count: routes.length }) })}
                  </p>
                  <p className="mt-1.5">
                    {restrictedRouteIds.size === 1 ? m.pe_restricted_a_one() : m.pe_restricted_a_other()}{' '}
                    <span className="font-semibold">{restrictedRouteIds.size === 1 ? m.pe_restricted_b_one() : m.pe_restricted_b_other()}</span>{' '}
                    {m.pe_restricted_c()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SQEM-329 — the attach picker, given the shape of the Chat modal (`TemplateLaunchModal`).
          ⛔ **Deliberately not that component.** It carries a second step for filling in variables
          and hands finished text to a chat; none of that belongs here. Sharing it would mean
          teaching it a mode, and a mode is how one component becomes two features in one file. What
          is shared is the *look*, which is what somebody recognises. */}
      <Modal open={picking} onClose={() => setPicking(false)} size="lg" className="flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{m.pe_attach_title()}</h2>
          <button onClick={() => setPicking(false)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 space-y-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={pickSearch}
              onChange={e => setPickSearch(e.target.value)}
              placeholder={m.pb_search()}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400"
            />
          </div>
          <SegmentedTabs<'all' | PromptKind>
            value={pickKind}
            onChange={setPickKind}
            tabs={[
              { value: 'all', label: m.pb_tab_all() },
              { value: 'prompt', label: m.pb_tab_prompts(), icon: <PenTool className="w-3 h-3" /> },
              { value: 'skill', label: m.pb_tab_skills(), icon: <Wand2 className="w-3 h-3" /> },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {pickable.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-400 dark:text-slate-500">
              {/* Three different empty states, because they call for three different actions. */}
              {prompts.length === 0
                ? m.pe_pick_no_playbooks()
                : routes.length > 0 && pickSearch.trim() === '' && pickKind === 'all'
                  ? m.pe_pick_all_attached()
                  : m.pwiz_nothing_matches()}
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* SQEM-330 — the row is shared with the Persona Wizard (`TemplatePickRow`), which
                  grew the same markup three days apart and had already started to differ. */}
              {pickable.map(t => (
                <TemplatePickRow key={t.id} template={t} onClick={() => { attach(t); setPicking(false); }} />
              ))}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        title={m.ps_delete_title_one()}
        confirmLabel={m.pe_delete()}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      >
        <p>
          {m.pe_delete_body()}{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-300">{m.ps_delete_untouched()}</span> {m.ps_delete_untouched_rest()}
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={confirmLeave}
        title={m.pe_unsaved_title()}
        confirmLabel={m.ed_discard()}
        cancelLabel={m.pe_keep_editing()}
        onConfirm={() => navigate('/personas')}
        onClose={() => setConfirmLeave(false)}
      >
        <p>{m.pe_unsaved_body()}</p>
      </ConfirmModal>
    </div>
  );
}
