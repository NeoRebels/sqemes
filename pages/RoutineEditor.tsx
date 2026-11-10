import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertTriangle, ChevronDown, Info, Loader2, Plus, Save, Trash2, X, Plug, Globe, MessageSquare } from 'lucide-react';
import { usePrompts, useUI, useWorkspace } from '../store';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import Checkbox from '../components/ui/Checkbox';
import KindBadge from '../components/ui/KindBadge';
import SearchInput from '../components/ui/SearchInput';
import TemplatePickRow from '../components/ui/TemplatePickRow';
import { Input, Textarea } from '../components/ui/Input';
import FullScreenExit from '../components/ui/FullScreenExit';
import ConnectorLogo from '../components/ConnectorLogo';
import { PersonaSelect } from '../components/PersonaSelect';
import { ModelSelect } from '../components/ModelSelect';
import { m } from '../lib/i18n';
import { can } from '../lib/permissions';
import { PROVIDER_KEYS_TAB } from '../lib/chatKeyHint';
import { fetchPersonas } from '../lib/api/personas';
import { fetchConnectors, type Connector } from '../lib/api/connectors';
import { createRoutine, deleteRoutine, fetchRoutine, setRoutinePaused, updateRoutine, RoutineSaveError } from '../lib/api/routines';
import { buildEnabledModels, isImageModel } from '../lib/enabledModels';
import { AVAILABLE_MODELS } from '../constants';
import { DEFAULT_MODEL, isUnavailableModel, randomStartTime, routineModelOptions } from '../lib/routineModel';
import { resolvePersonaConnectors } from '../supabase/functions/_shared/connectorService';
import { ACTIVE_LIMIT, ALL_DAYS, browserTimeZone, dayShort, daysFor, rhythmOf, routineStateLine, runTimeLabel, staleReferences, timeShort, timeZoneOptions, type Rhythm } from '../lib/routineSchedule';
import type { Persona, Routine, RoutineInput } from '../types';

/**
 * SQEM-677 — create or change one routine (SQEM-672). Full-screen like the persona and playbook
 * editors: a long task text and a dozen choices want the room, and a phone wants no modal for them.
 *
 * ⛔ A persona's connectors are SHOWN here, never saved into `connector_ids`. `routine-run` resolves
 * them per run (the person's own connection first, a shared one otherwise), so a service the persona
 * gains or loses later is followed. Saved here, a connector would outlive the persona's choice.
 *
 * ⛔ References that no longer resolve (a deleted playbook or connector, a persona the person lost) are
 * dropped on load and said once. Kept invisibly, the database guard refused the next save with "remove
 * the entry" — and there was no entry on screen to remove (found in a design audit).
 *
 * SQEM-678 — name, task and schedule are enough for most routines, so everything that
 * shapes HOW it runs sits under "Advanced settings", closed by default and summed up in one line. A new
 * routine starts on the workspace's default model (`lib/routineModel.ts`) and at a random minute between
 * 07:00 and 08:59, so the default does not put every routine on the same minute.
 */
type Field = 'name' | 'prompt' | 'days' | 'time' | 'model';

const RoutineEditorForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { workspace, currentUser } = useWorkspace();
  const { prompts } = usePrompts();
  const { showToast, isLoading } = useUI();
  const uid = useId();
  const ids = {
    name: `${uid}-name`, prompt: `${uid}-prompt`, time: `${uid}-time`, tz: `${uid}-tz`, web: `${uid}-web`,
    rhythm: `${uid}-rhythm`, persona: `${uid}-persona`, model: `${uid}-model`,
  };
  const fieldRefs = useRef<Partial<Record<Field, HTMLElement | null>>>({});

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [rhythm, setRhythm] = useState<Rhythm>('weekdays');
  const [customDays, setCustomDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [time, setTime] = useState(() => randomStartTime());
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [playbookIds, setPlaybookIds] = useState<string[]>([]);
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [focusField, setFocusField] = useState<Field | null>(null);

  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [touched, setTouched] = useState(false);
  const [dropped, setDropped] = useState(0);
  const pruned = useRef(false);

  /** Every change the person makes goes through here, so leaving can ask first (as in PersonaEditor). */
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setIsDirty(true); };

  const enabledTextModels = useMemo(
    () => buildEnabledModels(workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable).filter(x => !isImageModel(x.id)),
    [workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable],
  );
  const modelOptions = useMemo(
    () => routineModelOptions({ apiKeys: workspace.apiKeys, openrouterModels: workspace.openrouterModels, fundedAvailable: workspace.fundedAvailable, authoringModelId: workspace.authoringModelId }),
    [workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable, workspace.authoringModelId],
  );
  const modelName = (mid: string) => enabledTextModels.find(x => x.id === mid)?.name ?? AVAILABLE_MODELS.find(x => x.id === mid)?.name ?? mid;
  const defaultEntry = useMemo(() => {
    const target = modelOptions.defaultId ? enabledTextModels.find(x => x.id === modelOptions.defaultId) : null;
    // A routine saved on the default stays on it, also when the workspace no longer offers one.
    if (!target && model !== DEFAULT_MODEL) return null;
    return { id: DEFAULT_MODEL, name: target ? m.rt_model_default({ name: target.name }) : m.rt_sum_default_model(), provider: target?.provider ?? 'sqemes' };
  }, [modelOptions.defaultId, enabledTextModels, model]);
  const modelUnavailable = model !== DEFAULT_MODEL && isUnavailableModel(model, enabledTextModels);
  // An edited routine keeps showing its own model even when its key is gone; the editor says so below it.
  const models = useMemo(() => {
    const list = defaultEntry ? [defaultEntry, ...enabledTextModels] : enabledTextModels;
    if (!modelUnavailable) return list;
    const known = AVAILABLE_MODELS.find(x => x.id === model);
    return [...list, known ?? { id: model, name: model, provider: 'openrouter' }];
  }, [defaultEntry, enabledTextModels, model, modelUnavailable]);
  const webAvailable = !!workspace.webSearchHosted || !!workspace.apiKeys.search_linkup || !!workspace.apiKeys.search_brave;
  const canAddKey = can(currentUser, workspace, 'team:manage');

  useEffect(() => {
    fetchPersonas(workspace.id, currentUser.id).then(setPersonas).catch(() => setPersonas([]));
    // Only what this person may use: shared ones and their own (the database refuses the rest).
    fetchConnectors(workspace.id).then(cs => setConnectors(cs.filter(c => c.user_id === null || c.user_id === currentUser.id))).catch(() => setConnectors([]));
  }, [workspace.id, currentUser.id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchRoutine(id).then(r => {
      if (cancelled) return;
      if (!r) { showToast(m.rt_not_found(), 'error'); navigate('/routines', { replace: true }); return; }
      setRoutine(r);
      setName(r.name); setPrompt(r.prompt);
      setRhythm(rhythmOf(r.days)); setCustomDays(r.days.length ? r.days : [1, 2, 3, 4, 5]);
      setTime(timeShort(r.timeOfDay)); setTimeZone(r.timeZone);
      setPersonaId(r.personaId); setPlaybookIds(r.playbookIds); setConnectorIds(r.connectorIds);
      setModel(r.model ?? DEFAULT_MODEL); setWebSearch(r.webSearch);
      // Open when the routine uses any of it — a choice hidden behind a closed section is easily forgotten.
      setAdvancedOpen(!!r.personaId || r.playbookIds.length > 0 || r.connectorIds.length > 0 || r.webSearch);
      setLoaded(true);
    }).catch(() => { if (!cancelled) { showToast(m.rt_load_failed(), 'error'); navigate('/routines', { replace: true }); } });
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once everything is known, drop what no longer resolves — once, and say how much.
  useEffect(() => {
    if (pruned.current || !loaded || !personas || !connectors || isLoading) return;
    pruned.current = true;
    const stale = staleReferences(
      { personaId, playbookIds, connectorIds },
      { personaIds: personas.map(p => p.id), playbookIds: prompts.map(p => p.id), connectorIds: connectors.map(c => c.id) },
    );
    if (stale.count === 0) return;
    setPersonaId(stale.personaId); setPlaybookIds(stale.playbookIds); setConnectorIds(stale.connectorIds);
    setDropped(stale.count);
    setIsDirty(true);
  }, [loaded, personas, connectors, isLoading, prompts]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new routine starts on the workspace's default (or, without one, on Chat's first model); an edited one keeps its own.
  useEffect(() => { if (!id && !model && modelOptions.initial) setModel(modelOptions.initial); }, [id, model, modelOptions.initial]);
  // An unknown model is a reason to look: the section opens by itself (once the model is known).
  useEffect(() => { if (loaded && modelUnavailable) setAdvancedOpen(true); }, [loaded, modelUnavailable]);
  // A field to fix inside the closed section is focused once the section has rendered.
  useEffect(() => {
    if (!focusField) return;
    const el = fieldRefs.current[focusField];
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
    setFocusField(null);
  }, [focusField, advancedOpen]);

  const persona = personas?.find(p => p.id === personaId) ?? null;
  const allConnectors = connectors ?? [];
  const personaServices = useMemo(
    () => (persona?.connectors?.length ? resolvePersonaConnectors(persona.connectors, allConnectors, currentUser.id) : { ids: [], missing: [] }),
    [persona, allConnectors, currentUser.id],
  );
  const viaPersona = new Set(personaServices.ids);
  const chosenPlaybooks = playbookIds.map(pid => prompts.find(p => p.id === pid)).filter((p): p is NonNullable<typeof p> => !!p);
  const pickable = prompts
    .filter(p => !playbookIds.includes(p.id))
    .filter(p => !pickSearch.trim() || p.title.toLowerCase().includes(pickSearch.trim().toLowerCase()));
  const zones = useMemo(() => {
    const q = tzSearch.trim().toLowerCase().replace(/\s+/g, '_');
    return timeZoneOptions(timeZone).filter(z => z === timeZone || !q || z.toLowerCase().includes(q));
  }, [timeZone, tzSearch]);
  const days = daysFor(rhythm, customDays);

  const problems: Record<Field, boolean> = {
    name: !name.trim(),
    prompt: !prompt.trim(),
    days: days.length === 0,
    time: !/^\d{2}:\d{2}$/.test(time),
    model: !model,
  };
  const order: Field[] = ['name', 'prompt', 'days', 'time', 'model'];
  const errId = (f: Field) => `${uid}-${f}-err`;
  const show = (f: Field) => touched && problems[f];
  const aria = (f: Field) => (show(f) ? { 'aria-invalid': true, 'aria-describedby': errId(f) } : {});

  const input = (): RoutineInput => ({
    name, prompt, personaId,
    playbookIds,
    // Never the persona's own: those resolve per run (see the note above the component).
    connectorIds: connectorIds.filter(c => !viaPersona.has(c)),
    model: model === DEFAULT_MODEL ? null : model || null,
    webSearch: webAvailable && webSearch,
    days, timeOfDay: time, timeZone,
  });

  const save = async () => {
    setTouched(true);
    const first = order.find(f => problems[f]);
    if (first) {
      // The save button sits in the header; the message may be far below. Take the person to it (the effect
      // above), opening the advanced section first when the field is in there.
      if (first === 'model') setAdvancedOpen(true);
      setFocusField(first);
      showToast(m.rt_check_fields(), 'error');
      return;
    }
    setSaving(true);
    try {
      if (id) {
        await updateRoutine(id, input());
        showToast(m.rt_saved(), 'success');
      } else {
        const { routine: created, paused } = await createRoutine(workspace.id, input());
        if (paused) showToast(m.rt_created_paused({ limit: ACTIVE_LIMIT }), 'info');
        // No "run now" (deliberately): the first save says when and where the first result arrives instead.
        else showToast(created.nextRunAt ? m.rt_created_first({ when: runTimeLabel(created.nextRunAt) }) : m.rt_created(), 'success');
      }
      setIsDirty(false);
      navigate('/routines');
    } catch (err) {
      const kind = err instanceof RoutineSaveError ? err.kind : 'other';
      showToast(
        kind === 'timezone' ? m.rt_err_timezone() : kind === 'reference' ? m.rt_err_reference() : kind === 'limit' ? m.rt_err_limit({ limit: ACTIVE_LIMIT }) : m.rt_save_failed(),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    try {
      await deleteRoutine(id);
      showToast(m.rt_deleted(), 'success');
      navigate('/routines');
    } catch {
      showToast(m.rt_delete_failed(), 'error');
    }
  };

  const togglePaused = async () => {
    if (!routine) return;
    setToggling(true);
    try {
      setRoutine(await setRoutinePaused(routine.id, routine.pausedReason === null));
    } catch (e) {
      showToast(e instanceof RoutineSaveError && e.kind === 'limit' ? m.rt_err_limit({ limit: ACTIVE_LIMIT }) : m.rt_save_failed(), 'error');
    } finally {
      setToggling(false);
    }
  };

  // SQEM-329 — leaving with changes asks first, in a modal (as PersonaEditor does).
  const leave = () => { if (isDirty) setConfirmLeave(true); else navigate('/routines'); };
  const chooseRhythm = (r: Rhythm) => {
    // Switching to "chosen days" starts from what was chosen so far, not from Monday alone.
    if (r === 'custom' && rhythm !== 'custom') setCustomDays(daysFor(rhythm, customDays));
    setRhythm(r); setIsDirty(true);
  };
  const toggleDay = (d: number) => { setCustomDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]); setIsDirty(true); };
  const toggleConnector = (cid: string) => { setConnectorIds(prev => prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]); setIsDirty(true); };

  const label = 'block text-sm font-semibold text-ink-strong mb-1.5';
  const help = 'text-xs text-ink-subtle mt-1.5';
  const err = 'text-xs text-danger mt-1.5';
  const sectionTitle = 'font-display text-lg font-semibold text-ink-strong';
  const state = routine ? routineStateLine(routine) : null;
  const connectorCount = new Set([...connectorIds.filter(c => !viaPersona.has(c)), ...personaServices.ids]).size;
  // The closed section's one line: what the routine runs with, in the order the fields come.
  const summary = [
    model === DEFAULT_MODEL ? m.rt_sum_default_model() : model ? modelName(model) : null,
    persona ? persona.title : m.rt_sum_no_persona(),
    chosenPlaybooks.length > 0 ? m.rt_sum_playbooks({ count: chosenPlaybooks.length }) : null,
    connectorCount > 0 ? m.rt_sum_connectors({ count: connectorCount }) : m.rt_sum_no_connectors(),
    webAvailable && webSearch ? m.rt_sum_web() : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col h-dvh bg-surface overflow-hidden">
      <header className="bg-surface-raised border-b border-line h-16 px-4 md:px-6 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo-favicon-V2.png" alt="sqemes" className="hidden sm:block w-8 h-8 rounded-lg shrink-0" />
          <h1 className="sr-only">{id ? m.rt_edit_title() : m.rt_new_title()}</h1>
          <FullScreenExit label={m.rt_back()} onExit={leave} />
        </div>
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
          {id && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2.5 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
              title={m.rt_delete()}
              aria-label={m.rt_delete()}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {/* At 375 px the long label wrapped and pushed the delete icon onto "Back"; phones get the short verb. */}
          <Button onClick={save} disabled={saving || !loaded} className="whitespace-nowrap">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="sm:hidden">{m.save_save()}</span>
            <span className="hidden sm:inline">{id ? m.ed_save_changes() : m.rt_create()}</span>
          </Button>
        </div>
      </header>

      {/* An existing routine's state lives here too: the list row leads to this page, and a routine paused
          after failures must not arrive at a form that says nothing about why. */}
      {routine && state && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-raised px-4 md:px-6 py-2.5">
          <p className={`min-w-0 flex-1 text-xs flex items-center gap-1.5 ${state.warn ? 'text-warning' : 'text-ink-muted'}`}>
            {state.warn && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
            <span>{state.text}</span>
          </p>
          {routine.lastSessionId && (
            <Link to={`/chat/${routine.lastSessionId}`} className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
              <MessageSquare className="w-3.5 h-3.5" /> {m.rt_last_result()}
            </Link>
          )}
          {/* The state line says "paused" already; the switch needs no second word for it. */}
          <div className="shrink-0 inline-flex items-center">
            <Switch checked={routine.pausedReason === null} disabled={toggling} onChange={togglePaused} size="sm"
              ariaLabel={routine.pausedReason === null ? m.rt_pause_x({ name: routine.name }) : m.rt_resume_x({ name: routine.name })} />
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="flex items-center gap-2 text-ink-subtle text-sm py-20 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> {m.rt_loading()}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 md:py-10 space-y-10">
            {dropped > 0 && (
              <p role="status" className="flex gap-2 rounded-card bg-warning-soft px-4 py-3 text-xs text-ink">
                <AlertTriangle className="w-4 h-4 shrink-0 text-warning" /> {m.rt_dropped({ count: dropped })}
              </p>
            )}

            {/* What */}
            <section className="space-y-5" aria-labelledby={`${uid}-s1`}>
              <h2 id={`${uid}-s1`} className={sectionTitle}>{m.rt_sec_what()}</h2>
              <div>
                <label htmlFor={ids.name} className={label}>{m.rt_name()}</label>
                <Input id={ids.name} ref={el => { fieldRefs.current.name = el; }} value={name} maxLength={120} onChange={e => edit(setName)(e.target.value)}
                  placeholder={m.rt_name_ph()} tone={show('name') ? 'error' : 'default'} {...aria('name')} />
                {show('name') && <p id={errId('name')} className={err}>{m.rt_name_required()}</p>}
              </div>
              <div>
                <label htmlFor={ids.prompt} className={label}>{m.rt_prompt()}</label>
                <Textarea id={ids.prompt} ref={el => { fieldRefs.current.prompt = el; }} value={prompt} maxLength={20000} rows={8} onChange={e => edit(setPrompt)(e.target.value)}
                  placeholder={m.rt_prompt_ph()} className="resize-y min-h-40" tone={show('prompt') ? 'error' : 'default'} {...aria('prompt')} />
                {show('prompt') ? <p id={errId('prompt')} className={err}>{m.rt_prompt_required()}</p> : <p className={help}>{m.rt_prompt_help()}</p>}
              </div>
              {/* SQEM-676 — what an unattended run does and does not do, said where the task is written. */}
              <aside className="flex gap-3 rounded-card bg-surface-sunken px-4 py-3.5">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-ink-subtle" />
                <div className="text-xs text-ink-muted space-y-1">
                  <p className="font-semibold text-ink">{m.rt_unattended_title()}</p>
                  <p>{m.rt_unattended_body()}</p>
                </div>
              </aside>
            </section>

            {/* When */}
            <section className="space-y-5" aria-labelledby={`${uid}-s2`}>
              <h2 id={`${uid}-s2`} className={sectionTitle}>{m.rt_sec_when()}</h2>
              <div role="group" aria-labelledby={ids.rhythm}>
                <span id={ids.rhythm} className={label}>{m.rt_rhythm()}</span>
                <SegmentedTabs<Rhythm>
                  className="w-full sm:w-fit whitespace-nowrap"
                  fill
                  value={rhythm}
                  onChange={chooseRhythm}
                  tabs={[
                    { value: 'daily', label: m.rt_rhythm_daily() },
                    { value: 'weekdays', label: m.rt_rhythm_weekdays() },
                    { value: 'custom', label: m.rt_rhythm_custom() },
                  ]}
                />
                {rhythm === 'custom' && (
                  <div ref={el => { fieldRefs.current.days = el; }} tabIndex={-1} className="grid grid-cols-7 gap-1.5 mt-3 sm:flex sm:flex-wrap outline-none" role="group" aria-label={m.rt_days()} {...aria('days')}>
                    {ALL_DAYS.map(d => {
                      const on = customDays.includes(d);
                      return (
                        <button key={d} type="button" aria-pressed={on} onClick={() => toggleDay(d)}
                          className={`sm:w-11 h-9 rounded-chip text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                            on ? 'bg-accent-soft border-accent text-accent' : 'bg-surface-field border-line-strong text-ink-muted hover:text-ink-strong'
                          }`}>
                          {dayShort(d)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {show('days') && <p id={errId('days')} className={err}>{m.rt_days_required()}</p>}
              </div>
              <div className="max-w-[10rem]">
                <label htmlFor={ids.time} className={label}>{m.rt_time()}</label>
                <Input id={ids.time} ref={el => { fieldRefs.current.time = el; }} type="time" step={60} value={time} onChange={e => edit(setTime)(e.target.value)}
                  className="tabular-nums" tone={show('time') ? 'error' : 'default'} {...aria('time')} />
                {show('time') && <p id={errId('time')} className={err}>{m.rt_time_required()}</p>}
              </div>
              {/* The zone is right for almost everyone (the browser's); the full list of 400+ only on request. */}
              {!tzOpen ? (
                <p className="text-sm text-ink-muted">
                  {m.rt_timezone()}: <span className="font-medium text-ink">{timeZone.replace(/_/g, ' ')}</span>{' '}
                  <button type="button" onClick={() => setTzOpen(true)} className="font-semibold text-accent hover:underline">{m.rt_tz_change()}</button>
                </p>
              ) : (
                <div className="space-y-2">
                  <label htmlFor={ids.tz} className={label}>{m.rt_timezone()}</label>
                  <SearchInput value={tzSearch} onChange={setTzSearch} placeholder={m.rt_tz_search()} ariaLabel={m.rt_tz_search()} containerClassName="w-full" />
                  <Select id={ids.tz} value={timeZone} onChange={e => edit(setTimeZone)(e.target.value)}>
                    {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                  </Select>
                </div>
              )}
              <p className={help}>{m.rt_when_help()}</p>
            </section>

            {/* SQEM-678 — advanced: closed by default, summed up in one line while closed. */}
            <section className="border-t border-line pt-8" aria-labelledby={`${uid}-s3`}>
              <h2 id={`${uid}-s3`} className={sectionTitle}>
                <button type="button" onClick={() => setAdvancedOpen(o => !o)} aria-expanded={advancedOpen} aria-controls={`${uid}-adv`}
                  className="group flex w-full items-center justify-between gap-3 rounded-control text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-4 focus-visible:ring-offset-surface">
                  <span>{m.rt_advanced()}</span>
                  <ChevronDown aria-hidden className={`w-5 h-5 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:text-ink-strong ${advancedOpen ? 'rotate-180' : ''}`} />
                </button>
              </h2>
              {!advancedOpen && <p className="mt-1.5 text-sm text-ink-muted">{summary}</p>}
              {/* Rendered while closed too (hidden), so aria-controls always names an element. */}
              <div id={`${uid}-adv`} hidden={!advancedOpen} className="mt-6 space-y-6">
                <p className="-mt-4 text-xs text-ink-subtle">{m.rt_advanced_help()}</p>

                <div role="group" aria-labelledby={ids.persona}>
                  <span id={ids.persona} className={label}>{m.rt_persona()}</span>
                  {/* The select is a chip (Start, Chat); its chevron sits at the wrapper's edge, so the wrapper fits it. */}
                  <div className="w-fit max-w-full">
                    <PersonaSelect personas={personas ?? []} value={personaId} onChange={p => edit(setPersonaId)(p?.id ?? null)} />
                  </div>
                </div>

                <div>
                  <span className={label}>{m.rt_playbooks()}</span>
                  {chosenPlaybooks.length > 0 && (
                    <ul className="mb-2 space-y-1.5">
                      {chosenPlaybooks.map(p => (
                        <li key={p.id} className="flex items-center gap-2 pl-3 pr-1.5 py-2 rounded-control border border-line bg-surface-raised">
                          <KindBadge kind={p.kind} />
                          <span className="min-w-0 flex-1 text-sm font-medium text-ink-strong truncate">{p.title}</span>
                          <button type="button" onClick={() => edit(setPlaybookIds)(playbookIds.filter(x => x !== p.id))}
                            aria-label={m.rt_remove_x({ name: p.title })}
                            className="shrink-0 w-7 h-7 rounded-chip flex items-center justify-center text-ink-subtle hover:text-danger hover:bg-danger-soft transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => { setPickSearch(''); setPicking(true); }} disabled={playbookIds.length >= 20}>
                    <Plus className="w-3.5 h-3.5" /> {m.rt_add_playbook()}
                  </Button>
                </div>

                <div>
                  <span className={label}>{m.rt_connectors()}</span>
                  {/* SQEM-641 — the persona's services come with it, resolved per run. */}
                  {persona && (personaServices.ids.length > 0 || personaServices.missing.length > 0) && (
                    <ul className="mb-2 space-y-1.5" aria-label={m.rt_via_persona_list({ name: persona.title })}>
                      {allConnectors.filter(c => viaPersona.has(c.id)).map(c => (
                        <li key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-control bg-surface-sunken">
                          <ConnectorLogo mcpUrl={c.mcp_url} className="w-5 h-5 shrink-0" />
                          <span className="min-w-0 flex-1 text-sm text-ink truncate">{c.name}</span>
                          <span className="shrink-0 text-xs text-ink-subtle whitespace-nowrap">{m.rt_via_persona()}</span>
                        </li>
                      ))}
                      {personaServices.missing.map(s => (
                        <li key={s.key} className="flex items-center gap-3 px-3 py-2 rounded-control bg-surface-sunken">
                          <Plug className="w-5 h-5 shrink-0 text-ink-subtle" />
                          <span className="min-w-0 flex-1 text-sm text-ink-muted truncate">{s.name}</span>
                          <Link to="/settings" state={{ initialTab: 'connectors' }} className="shrink-0 text-xs font-semibold text-accent hover:underline whitespace-nowrap">
                            {m.rt_not_connected()}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {allConnectors.filter(c => !viaPersona.has(c.id)).length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      {m.rt_no_connectors()}{' '}
                      <Link to="/settings" state={{ initialTab: 'connectors' }} className="font-semibold text-accent hover:underline">{m.rt_connect()}</Link>
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {allConnectors.filter(c => !viaPersona.has(c.id)).map(c => (
                        <li key={c.id}>
                          <label className="flex items-center gap-3 px-3 py-2 rounded-control hover:bg-surface-sunken cursor-pointer">
                            <Checkbox checked={connectorIds.includes(c.id)} onChange={() => toggleConnector(c.id)} align="center" aria-label={c.name} />
                            <ConnectorLogo mcpUrl={c.mcp_url} className="w-5 h-5 shrink-0" />
                            <span className="min-w-0 flex-1 text-sm text-ink truncate">{c.name}</span>
                            {c.user_id === null && <span className="shrink-0 text-xs text-ink-subtle">{m.rt_shared()}</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className={help}>
                    {m.rt_connectors_help()}{' '}
                    <Link to="/settings" state={{ initialTab: 'connectors' }} className="font-semibold text-accent hover:underline">{m.rt_tool_choice()}</Link>
                  </p>
                </div>

                <div role="group" aria-labelledby={ids.model} ref={el => { fieldRefs.current.model = el; }} tabIndex={-1} className="outline-none" {...aria('model')}>
                  <span id={ids.model} className={label}>{m.rt_model()}</span>
                  <ModelSelect models={models} value={model} onChange={edit(setModel)} fullWidth emptyLabel={m.rt_no_model()} />
                  {modelUnavailable ? (
                    <p className="text-xs text-warning mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {m.rt_model_unavailable({ name: modelName(model) })}</span>
                      {defaultEntry && <button type="button" onClick={() => edit(setModel)(DEFAULT_MODEL)} className="font-semibold text-accent hover:underline">{m.rt_use_default()}</button>}
                    </p>
                  ) : !modelOptions.defaultId && model && model !== DEFAULT_MODEL && !show('model') ? (
                    <p className={help}>{m.rt_model_pinned()}</p>
                  ) : null}
                  {show('model') && (
                    <p id={errId('model')} className={err}>
                      {m.rt_model_required()}{' '}
                      {canAddKey && <Link to="/settings" state={{ initialTab: PROVIDER_KEYS_TAB }} className="font-semibold underline">{m.rt_add_key()}</Link>}
                    </p>
                  )}
                </div>

                {webAvailable && (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span id={ids.web} className="flex items-center gap-2 text-sm font-semibold text-ink-strong"><Globe className="w-4 h-4 text-ink-subtle" /> {m.rt_web()}</span>
                      <p className="text-xs text-ink-subtle mt-0.5">{m.rt_web_help()}</p>
                    </div>
                    <Switch checked={webSearch} onChange={edit(setWebSearch)} labelledBy={ids.web} />
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <Modal open={picking} onClose={() => setPicking(false)} size="lg" className="flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <h2 className="text-base font-bold text-ink-strong">{m.rt_add_playbook()}</h2>
          <button onClick={() => setPicking(false)} aria-label={m.save_cancel()}
            className="p-1.5 text-ink-subtle hover:text-ink-strong rounded-lg hover:bg-surface-sunken transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pt-3 pb-2 shrink-0">
          <SearchInput value={pickSearch} onChange={setPickSearch} placeholder={m.rt_search_playbooks()} containerClassName="w-full" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {pickable.length === 0 ? (
            <p className="text-center py-10 text-sm text-ink-subtle">{prompts.length === 0 ? m.pe_pick_no_playbooks() : m.pwiz_nothing_matches()}</p>
          ) : (
            <div className="space-y-1.5">
              {pickable.map(t => (
                <TemplatePickRow key={t.id} template={t} onClick={() => { edit(setPlaybookIds)([...playbookIds, t.id]); setPicking(false); }} />
              ))}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal open={confirmDelete} title={m.rt_delete_title()} confirmLabel={m.rt_delete()}
        onConfirm={() => { setConfirmDelete(false); void remove(); }} onClose={() => setConfirmDelete(false)}>
        <p><span className="font-medium">{name}</span> — {m.rt_delete_body()}</p>
      </ConfirmModal>

      <ConfirmModal open={confirmLeave} title={m.pe_unsaved_title()} confirmLabel={m.ed_discard()} cancelLabel={m.pe_keep_editing()}
        onConfirm={() => navigate('/routines')} onClose={() => setConfirmLeave(false)}>
        <p>{m.pe_unsaved_body()}</p>
      </ConfirmModal>
    </div>
  );
};

/**
 * Keyed by the route: going from `/routines/:id/edit` to `/routines/new` (browser back/forward) kept the
 * old form's state, and saving then created a copy of the routine (found in the impeccable re-check).
 */
const RoutineEditor = () => {
  const { id } = useParams();
  return <RoutineEditorForm key={id ?? 'new'} />;
};

export default RoutineEditor;
