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
  Settings, PenTool, ListTree, Search, Bot, Wand2, UserRound, Lock,
} from 'lucide-react';
import { useWorkspace, useUI, usePrompts } from '../store';
import { can } from '../lib/permissions';
import { runAuthoringAI, authoringModelId } from '../lib/authoringAI';
import {
  fetchPersona, createPersona, updatePersona, setPersonaRoutes, deletePersona,
} from '../lib/api/personas';
import type { PersonaRoute, Prompt, PromptKind } from '../types';
import FullScreenExit from '../components/ui/FullScreenExit';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import PersonCard from '../components/ui/PersonCard';
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
import {
  fetchPersonaAccess, setPersonaAccess, accessValueToPersonaAccess, personaAccessToValue,
  fetchRestrictedTemplateIdsAmong,
} from '../lib/api/personaAccess';

export default function PersonaEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { workspace, currentUser } = useWorkspace();
  const { showToast } = useUI();
  const { prompts } = usePrompts();

  const canEdit = can(currentUser, workspace, 'prompts:edit');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
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
  const [restrictedRouteIds, setRestrictedRouteIds] = useState<Set<string>>(new Set());
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
          showToast('Persona not found', 'error');
          navigate('/personas');
          return;
        }
        setTitle(persona.title);
        setDescription(persona.description);
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
            showToast(err?.message || 'Could not read who may use this persona', 'error');
          }
        }
      } catch (err: any) {
        if (!cancelled) showToast(err?.message || 'Could not load the persona', 'error');
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
    if (IS_SELF_HOSTED || !workspace?.id || routes.length === 0) { setRestrictedRouteIds(new Set()); return; }
    let cancelled = false;
    fetchRestrictedTemplateIdsAmong(workspace.id, routes.map(r => r.templateId))
      .then(ids => { if (!cancelled) setRestrictedRouteIds(ids); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspace?.id, routes]);

  // SQEM-330 — the owner, resolved against the current member list. Undefined means either "never
  // recorded" or "no longer here", and the two are told apart by whether `ownerId` is set at all.
  const owner = useMemo(
    () => (workspace?.members ?? []).find(m => m.id === ownerId),
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
    setRoutes(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next.map((r, i) => ({ ...r, sortOrder: i }));
    });
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
      showToast('Write something first — enhance improves what is there.', 'error');
      return;
    }
    setEnhancing(true);
    try {
      const routeSummary = routes.length
        ? routes.map(r => `- ${r.templateTitle || 'Untitled'}${r.condition ? `: ${r.condition}` : ''}`).join('\n')
        : '(none attached yet)';

      const systemInstruction = `You refine the role description of a PERSONA — a working role that an AI assistant adopts.

A persona has two parts, and you are given both but may only rewrite the first:
1. The ROLE DESCRIPTION — who this role is, how it works, what it asks for before acting, what it never does. This is what you rewrite.
2. The ROUTES — attached templates with the condition under which each is loaded. These are managed elsewhere. They are given to you as context so the role description fits them.

Rules:
- Keep the author's intent and voice; sharpen structure and specificity.
- Write in the second person, addressing the assistant that will adopt the role.
- ⛔ Do NOT write a routing table, a list of the templates, or any "if X then load Y" instructions. The routing is added automatically after you.
- Do not invent capabilities the routes do not support.
- Output only the refined role description, with no commentary.

ATTACHED ROUTES (context only, do not reproduce):
${routeSummary}`;

      const enhanced = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId: authoringModelId(workspace),
        systemInstruction,
        prompt: `<persona_role>\n${content.trim()}\n</persona_role>`,
        temperature: 1,
      });
      if (enhanced) {
        setContent(enhanced);
        setIsDirty(true);
        showToast('Role description enhanced ✨', 'success');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to enhance the persona', 'error');
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
      showToast('Write the role or attach a template first — there is nothing to describe yet.', 'error');
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

      const systemInstruction = `You write the one-line description of a PERSONA — a working role an AI assistant can adopt, bundling several templates behind conditions.

This description is displayed in an MCP client's picker and in tool output. It is usually the ONLY thing a person or a model sees before deciding whether to load this persona.

Write 1-2 sentences that answer: **for which kind of task should someone pick this role?**
- Lead with the situation, not with the word "persona" or the name.
- Name the concrete areas it covers, drawn from the attached templates below.
- No marketing, no "helps you to", no restating the title.
- Output only the description, with no quotes or commentary.`;

      const generated = await runAuthoringAI({
        workspaceId: workspace.id,
        modelId: authoringModelId(workspace),
        systemInstruction,
        prompt: `Persona name: ${title || '(unnamed)'}\n\nRole description:\n${content.trim() || '(empty)'}\n\nAttached templates:\n${routeSummary || '(none)'}`,
        temperature: 0.3,
      });
      if (generated) {
        setDescription(generated.trim());
        setIsDirty(true);
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to generate the description', 'error');
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

The condition completes the sentence "load this template when …". It is read by an AI assistant that has adopted the persona and must decide, mid-conversation, whether this template applies.

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
        temperature: 0.4,
      });
      if (generated) setCondition(route.templateId, generated.trim().replace(/^["']|["']$/g, ''));
    } catch (err: any) {
      showToast(err?.message || 'Failed to write the condition', 'error');
    } finally {
      setConditioning(null);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('Give the persona a name.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (id) {
        await updatePersona(id, { title: title.trim(), description: description.trim(), content });
        await setPersonaRoutes(id, routes);
        if (!IS_SELF_HOSTED) {
          await setPersonaAccess(id, workspace.id, accessValueToPersonaAccess(access, ownerId));
        }
      } else {
        const created = await createPersona(
          workspace.id,
          { title: title.trim(), description: description.trim(), content, routes },
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
              `Saved, but who may use it could not be applied — it is open to the workspace. ${accessErr?.message ?? ''}`.trim(),
              'error',
            );
          }
        }
        navigate(`/personas/${created.id}/edit`, { replace: true });
      }
      setIsDirty(false);
      showToast('Persona saved', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to save the persona', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deletePersona(id);
      showToast('Persona deleted', 'success');
      navigate('/personas');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete the persona', 'error');
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
      <div className="flex items-center justify-center h-screen text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading persona…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 overflow-hidden">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 h-16 px-4 md:px-6 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-2">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="w-8 h-8 rounded-lg shrink-0" />
          <FullScreenExit label="Back to Personas" onExit={handleBack} />
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {id && canEdit && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
              title="Delete persona"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {canEdit && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
          )}
        </div>
      </header>

      {/* Mobile tab switcher — the three columns cannot sit side by side on a phone, and stacking
          them buries the routes under a long textarea. Same three-way switch as the template
          editor, so the two pages behave identically where it matters most. */}
      <div className="xl:hidden flex border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        {([
          { id: 'details' as const, label: 'Details', icon: <Settings className="w-4 h-4" /> },
          { id: 'role' as const, label: 'Role', icon: <PenTool className="w-4 h-4" /> },
          { id: 'routes' as const, label: 'Routes', icon: <ListTree className="w-4 h-4" /> },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setMobileTab(t.id)}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileTab === t.id ? 'text-brand-600 border-b-2 border-brand-600 bg-white dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden relative">

        {/* ── Left: what the persona IS ─────────────────────────────────────
            Name, description and who may use it. Same width and tone as the template editor's
            settings rail, because it answers the same class of question: metadata about the thing,
            not the thing itself. */}
        <div className={`w-full xl:w-[420px] bg-slate-50/50 dark:bg-slate-800/50 border-r border-slate-100 dark:border-slate-700 overflow-y-auto p-6 shrink-0 ${mobileTab === 'details' ? 'block' : 'hidden xl:block'}`}>
          <div className="space-y-8">
            <div>
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Name</label>
              <input
                value={title}
                onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                disabled={!canEdit}
                placeholder="Sales"
                className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Description</label>
                {canEdit && (
                  <button
                    onClick={handleGenerateDescription}
                    disabled={describing}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {describing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Write it for me
                  </button>
                )}
              </div>
              <textarea
                value={description}
                onChange={e => { setDescription(e.target.value); setIsDirty(true); }}
                disabled={!canEdit}
                rows={3}
                placeholder="Offers, use cases and workshop material for the sales team"
                className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all resize-none"
              />
              <p className="text-2xs text-slate-400 mt-1.5">
                Shown in your MCP client&apos;s picker, and often the only thing a person or a model sees
                before choosing. Write it for the decision: <span className="italic">for which task is this the right role?</span>
              </p>
            </div>

            {/* SQEM-326 — who may use the persona. Cloud-only, like every other access surface
                (SQEM-170/323): on self-host nothing is rendered here at all, rather than a box
                explaining a feature that instance does not have. */}
            {!IS_SELF_HOSTED && canEdit && accessAppliesTo(workspace, access.mode !== 'everyone') && (
              <TemplateAccessControl
                value={access}
                onChange={v => { setAccess(v); setIsDirty(true); }}
                label="Access"
                hint="Who can see & use this persona"
                members={workspace?.members}
                groups={groups}
                onCreateGroup={currentUser?.role === 'admin'
                  ? () => navigate('/settings', { state: { initialTab: 'general' } })
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
                    ? 'Unavailable — this persona has no owner recorded, so “only me” would hide it from everyone'
                    : undefined
                }
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
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Owner</label>
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
                        {ownerId ? 'No longer in this workspace' : 'None recorded'}
                      </span>
                      <span className="block text-2xs text-slate-400 dark:text-slate-500">
                        {ownerId
                          ? 'The creator has left; the persona stays where it is.'
                          : 'Created without a recorded owner — “Only me” is unavailable.'}
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
        <div className={`flex flex-col bg-white dark:bg-slate-900 overflow-hidden flex-1 min-w-0 ${mobileTab === 'role' ? 'flex' : 'hidden xl:flex'}`}>
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Role &amp; rules</label>
            {canEdit && (
              <button
                onClick={handleEnhance}
                disabled={enhancing}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 disabled:opacity-50 transition-colors"
              >
                {enhancing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Enhance with AI
              </button>
            )}
          </div>
          <textarea
            value={content}
            onChange={e => { setContent(e.target.value); setIsDirty(true); }}
            disabled={!canEdit}
            placeholder={'You work in sales at …\n\nAsk for the customer context before drafting anything.\nNever quote a price that is not in the attached material.'}
            className="flex-1 p-6 text-sm font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 resize-none outline-none leading-relaxed placeholder-slate-300 dark:placeholder-slate-600"
          />
          {/* ⚠️ Stated rather than left to be discovered: people will try to write the routing into
              this box, because that is how it reads once the client renders it. */}
          <p className="text-2xs text-slate-400 px-6 py-2.5 border-t border-slate-100 dark:border-slate-700 shrink-0">
            Only the role itself. The routing table is built from the routes and added automatically.
          </p>
        </div>

        {/* ── Right: the routes ─────────────────────────────────────────────
            Its own rail rather than a section under the prose: attaching a template and writing the
            role are two different activities, and the routes have to stay visible while the role is
            written — the role is *about* them. */}
        <div className={`w-full xl:w-[380px] bg-slate-50/50 dark:bg-slate-800/50 border-l border-slate-100 dark:border-slate-700 overflow-y-auto p-6 shrink-0 ${mobileTab === 'routes' ? 'block' : 'hidden xl:block'}`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Routes</label>
              {canEdit && (
                <button
                  onClick={() => { setPickSearch(''); setPicking(true); }}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Attach template
                </button>
              )}
            </div>
            <p className="text-2xs text-slate-400 dark:text-slate-500 -mt-2">
              A route says <span className="font-semibold">when</span> to load a template — the client
              fetches one only once its condition applies, which is what keeps a persona cheap.
              Leave the condition empty and the template&apos;s own description is used.
            </p>

            {routes.length === 0 && (
              <div className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
                <p className="font-semibold text-slate-600 dark:text-slate-300">No routes yet</p>
                <p className="mt-1">Without a route this persona is a role description and nothing else — it can load nothing.</p>
              </div>
            )}

            {routes.map((route, i) => (
              <div
                key={route.templateId}
                draggable={canEdit}
                onDragStart={() => { dragIndex.current = i; }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3"
              >
                <div className="flex items-start gap-2 mb-2">
                  {canEdit && <GripVertical className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5 cursor-grab" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {route.templateKind && <KindBadge kind={route.templateKind} />}
                      {/* SQEM-330 — the row the sentence below is counting. Without this the warning
                          gives a number and leaves the reader to work out which three of seven.

                          ⚠️ **Amber here, slate on the Templates page, and the word is the same.**
                          On a template card "Restricted" is a fact about that template. Inside a
                          persona it is a *consequence* — this route will not reach part of the
                          team — and it is the same amber as the sentence that spells the
                          consequence out, so the two read as one statement. Different weight, not a
                          second vocabulary: change the word here and the two screens start
                          disagreeing about what restricted means. */}
                      {!IS_SELF_HOSTED && restrictedRouteIds.has(route.templateId) && (
                        <span
                          className="text-2xs font-bold px-2 py-0.5 rounded-lg uppercase tracking-wider flex items-center gap-1 shrink-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                          title="Restricted — colleagues who cannot open it receive this persona without this route"
                        >
                          <Lock className="w-3 h-3" /> Restricted
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate" title={route.templateTitle}>
                      {route.templateTitle || 'Untitled template'}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => removeRoute(route.templateId)}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors shrink-0"
                      title="Remove this route"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Load when
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => handleGenerateCondition(route)}
                      disabled={conditioning === route.templateId}
                      className="flex items-center gap-1 text-2xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 disabled:opacity-50 transition-colors"
                      title="Write a condition for this persona specifically"
                    >
                      {conditioning === route.templateId
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Sparkles className="w-3 h-3" />}
                      Write
                    </button>
                  )}
                </div>
                <input
                  value={route.condition}
                  onChange={e => setCondition(route.templateId, e.target.value)}
                  disabled={!canEdit}
                  placeholder={templateById.get(route.templateId)?.description || 'when the user wants an offer laid out'}
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 outline-none focus:border-brand-500"
                />
                {/* ⛔ Empty is a normal, good state — not a warning. The fallback is the template's
                    own description, resolved when the persona is rendered so it never goes stale.
                    The override exists for the case that description cannot cover: the same
                    template meaning different things in two personas. */}
                {!route.condition.trim() && (
                  <p className="text-2xs text-slate-400 dark:text-slate-500 mt-1.5">
                    {templateById.get(route.templateId)?.description
                      ? <>Using the template&apos;s own description. Write something here only if it means something different <span className="italic">in this persona</span>.</>
                      : <>This template has no description either — without one the model gets only its title. Write a condition, or give the template a description.</>}
                  </p>
                )}
              </div>
            ))}

            {/* ⛔ SQEM-326 — the sentence that stops this feature degrading in silence. A persona
                shared with the workspace may attach a template restricted to its author; colleagues
                then receive it **without** those routes: it works, it is quietly worse, and nobody
                can tell why. Filtering happens against the CALLER's rights, never the author's —
                attaching must never widen access — so the only honest fix is to say so here.

                SQEM-330 — moved out of the left rail and under the routes, where the rows it talks
                about are. In the metadata column it was a sentence about something the reader could
                not see while reading it.

                ⚠️ Rendered only when there is something to report. "All templates are open" is a
                sentence nobody needs, and a permanently visible box about access is how a warning
                stops being read. */}
            {!IS_SELF_HOSTED && restrictedRouteIds.size > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 mt-4">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="text-2xs text-amber-800 dark:text-amber-200">
                  <p className="font-semibold">
                    {restrictedRouteIds.size} of {routes.length} template{routes.length === 1 ? '' : 's'} {restrictedRouteIds.size === 1 ? 'is' : 'are'} restricted
                  </p>
                  <p className="mt-1.5">
                    Colleagues who cannot open {restrictedRouteIds.size === 1 ? 'it' : 'them'} receive this
                    persona <span className="font-semibold">without {restrictedRouteIds.size === 1 ? 'that route' : 'those routes'}</span> —
                    the route is left out entirely, never shown as unavailable. Share the template if they should have it.
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
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Attach a template</h2>
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
              placeholder="Search templates..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400"
            />
          </div>
          <SegmentedTabs<'all' | PromptKind>
            value={pickKind}
            onChange={setPickKind}
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'prompt', label: 'Prompts', icon: <PenTool className="w-3 h-3" /> },
              { value: 'assistant', label: 'Assistants', icon: <Bot className="w-3 h-3" /> },
              { value: 'skill', label: 'Skills', icon: <Wand2 className="w-3 h-3" /> },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {pickable.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-400 dark:text-slate-500">
              {/* Three different empty states, because they call for three different actions. */}
              {prompts.length === 0
                ? 'This workspace has no templates yet — a persona needs something to route to.'
                : routes.length > 0 && pickSearch.trim() === '' && pickKind === 'all'
                  ? 'Every template is already attached.'
                  : 'Nothing matches.'}
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
        title="Delete this persona?"
        confirmLabel="Delete persona"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      >
        <p>
          The persona and its routes are removed.{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-300">The templates themselves are not touched</span> — they keep working on their own.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={confirmLeave}
        title="Unsaved changes"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => navigate('/personas')}
        onClose={() => setConfirmLeave(false)}
      >
        <p>You have unsaved changes. Leaving now discards them.</p>
      </ConfirmModal>
    </div>
  );
}
