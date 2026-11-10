// SQEM-676 — one run of a routine (Routines, epic SQEM-672). Called by the `routines-tick` cron job through
// pg_net, once per run `claim_routine_runs` handed out. Never by a browser.
//
// What it does: checks the run is still the database's, creates the routine's chat (private, with the
// person's prompt as the first message), composes the system instruction on the server with the person's
// rights TODAY (the same library reader MCP uses), and hands the answer to `chat-message` with a signed
// ticket instead of a login (`_shared/routineRun.ts`). `chat-message` writes the answer and finishes the run.
//
// ⛔ Authorised by `ROUTINE_DISPATCH_SECRET` only — a secret of its own, held in the Vault for the cron job
// and in this function's env. Not the service key: the job needs to start runs, nothing more.
// ⛔ A run that is not `running` in `routine_queue` is not started, whatever the caller says.
// ⛔ Counts only in the log, never a prompt, an answer or a name.

import { createAdminClient } from '../_shared/supabase-admin.ts';
import { createLibraryReader, LibraryNotFound } from '../_shared/libraryQueries.ts';
import { unzipEntries } from '../_shared/officeZip.ts';
import { LOADTEST_MODEL, LOADTEST_HEADER } from '../_shared/loadtestMock.ts';
import { resolvePersonaConnectors, type PersonaConnector } from '../_shared/connectorService.ts';
import {
  sameSecret, signTicket, buildRoutineInstruction, routineChatTitle, routineFailureText,
  routineMissingServicesNote, TICKET_TTL_MS, type RoutinePlaybook,
} from '../_shared/routineRun.ts';
import { routineDispatchSecret } from '../_shared/routineSecret.ts';
import { CHOSEN_PERSONA_NOTE } from '../_shared/libraryPrompt.ts';
import { resolveRoutineModel, routineModelReplacedNote, type RoutineModel } from '../_shared/routineModel.ts';

const done = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return done(405);
  // SQEM-679 — on self-host derived from the service key when unset (`_shared/routineSecret.ts`).
  const secret = await routineDispatchSecret(name => Deno.env.get(name));
  if (secret.length < 32 || !sameSecret(req.headers.get('x-routine-dispatch') ?? '', secret)) return done(401);

  const body = await req.json().catch(() => ({}));
  const queueId = Number(body?.queueId);
  if (!Number.isInteger(queueId)) return done(400);

  const admin = createAdminClient();
  const { data: q } = await admin.from('routine_queue')
    .select('id, routine_id, user_id, workspace_id, state, due_at, attempt, session_id').eq('id', queueId).maybeSingle();
  if (!q || q.state !== 'running') return done(409, { skipped: 'not running' });

  // A run that cannot happen and is nobody's failure leaves the queue without counting one.
  const drop = async (outcome: string) => {
    await admin.from('routine_queue').delete().eq('id', queueId);
    console.log('[routine-run]', JSON.stringify({ outcome, attempt: q.attempt }));
    return done(200, { skipped: outcome });
  };

  const { data: r } = await admin.from('routines').select('*').eq('id', q.routine_id).maybeSingle();
  if (!r || r.paused_reason) return drop('paused-or-gone');
  const { data: member } = await admin.from('workspace_members')
    .select('role').eq('workspace_id', r.workspace_id).eq('user_id', r.user_id).maybeSingle();
  if (!member) return drop('not-a-member');

  const [{ data: profile }, { data: ws }, { data: keyRows }] = await Promise.all([
    admin.from('profiles').select('language').eq('id', r.user_id).maybeSingle(),
    admin.from('workspaces').select('language, authoring_model_id').eq('id', r.workspace_id).maybeSingle(),
    admin.from('workspace_api_keys').select('provider').eq('workspace_id', r.workspace_id),
  ]);
  const locale: 'de' | 'en' = (profile?.language ?? ws?.language) === 'de' ? 'de' : 'en';
  const waitMs = Date.now() - Date.parse(q.due_at);

  // SQEM-678 — the model: null = the workspace's default; a chosen one that cannot run is replaced by it.
  const isLoadtest = String(r.model ?? '').startsWith(LOADTEST_MODEL);
  const runModel: RoutineModel = isLoadtest
    ? { primary: { modelId: r.model }, fallback: null, replaced: null }
    : resolveRoutineModel(r.model ?? null, ws?.authoring_model_id ?? null, new Set(((keyRows as any[]) ?? []).map(k => String(k.provider))));

  // ── The instruction, with the person's rights now ────────────────────────────────────────────────
  const reader = await createLibraryReader({ client: admin, workspaceId: r.workspace_id, userId: r.user_id, unzip: unzipEntries });
  let personaText: string | null = null;
  let personaServices: PersonaConnector[] = [];
  const notes: string[] = [];
  if (runModel.replaced) notes.push(routineModelReplacedNote(runModel.replaced, locale));
  let unavailable = 0;
  if (r.persona_id) {
    try {
      const p = await reader.getPersona({ id: r.persona_id });
      personaText = p.text;
      personaServices = p.connectors;
    } catch (e) {
      if (!(e instanceof LibraryNotFound)) throw e;
      unavailable++;
    }
  }
  const playbooks: RoutinePlaybook[] = [];
  const skillIds: string[] = [];
  for (const id of (r.playbook_ids ?? []) as string[]) {
    try {
      // `auto`: a skill as an outline (its files on demand), a prompt with its files in full — as MCP does.
      const t = await reader.getTemplate({ id, includeFiles: 'auto' });
      playbooks.push({ kind: t.kind, title: t.title, content: t.content, variables: t.variables });
      if (t.kind === 'skill') skillIds.push(t.id);
    } catch (e) {
      if (!(e instanceof LibraryNotFound)) throw e;
      unavailable++;
    }
  }
  if (unavailable) {
    notes.push(locale === 'de'
      ? `${unavailable} Playbook(s) oder die Persona dieser Routine sind für dich nicht mehr sichtbar und wurden ausgelassen.`
      : `${unavailable} playbook(s) or the persona of this routine are no longer visible to you and were left out.`);
  }

  // The persona's services: the person's own connection first, a shared one otherwise (SQEM-641).
  const { data: connectorRows } = await admin.from('workspace_connectors')
    .select('id, name, mcp_url, provider, user_id').eq('workspace_id', r.workspace_id);
  const available = ((connectorRows as any[]) ?? []).filter(c => c.user_id === null || c.user_id === r.user_id);
  const fromPersona = resolvePersonaConnectors(personaServices, available, r.user_id);
  const missingNote = routineMissingServicesNote(fromPersona.missing.map(s => s.name), locale);
  if (missingNote) notes.push(missingNote);
  const allowed = new Set(available.map(c => String(c.id)));
  const connectorIds = [...new Set([...(r.connector_ids ?? []), ...fromPersona.ids])].filter(id => allowed.has(id));
  // SQEM-680 — the person chose this persona for the routine: it stays the role (`CHOSEN_PERSONA_NOTE`).
  const systemInstruction = buildRoutineInstruction(personaText ? `${CHOSEN_PERSONA_NOTE}\n\n${personaText}` : null, playbooks, fromPersona.missing.map(s => s.name));

  // ── The chat ─────────────────────────────────────────────────────────────────────────────────────
  // ⛔ A retry writes into the chat of the first attempt (the queue row keeps it): a load test left one
  // silent chat per died attempt before this.
  let sessionId: string = q.session_id ?? '';
  if (sessionId) {
    await admin.from('chat_sessions').update({ is_generating: true }).eq('id', sessionId);
  } else {
    sessionId = crypto.randomUUID();
    const { error: sessionError } = await admin.from('chat_sessions').insert({
      id: sessionId, workspace_id: r.workspace_id, user_id: r.user_id,
      title: routineChatTitle(r.name, new Date(), r.time_zone, locale),
      model: r.model ?? '', persona_id: personaText ? r.persona_id : null, applied_skill_ids: skillIds,
      connector_ids: connectorIds, routine_id: r.id, visibility: 'private', is_generating: true,
    });
    if (sessionError) {
      console.error('[routine-run] chat not created:', sessionError.message);
      return done(500); // the lease runs out; the reaper retries once
    }
    await admin.from('chat_messages').insert({ session_id: sessionId, role: 'user', content: r.prompt });
    await admin.from('routine_queue').update({ session_id: sessionId }).eq('id', queueId);
  }

  // The end of a run that never reached chat-message: said in the chat, then finished.
  const endHere = async (content: string, outcome: string, ok: boolean) => {
    // ⛔ One transaction and only while this run still owns its queue row (see chat-message finishRoutine).
    await admin.rpc('complete_routine_run', { p_queue_id: queueId, p_ok: ok, p_session_id: sessionId, p_content: content });
    console.log('[routine-run]', JSON.stringify({ outcome, waitMs, attempt: q.attempt }));
    return done(200, { outcome });
  };

  // ── Hand the answer to chat-message ─────────────────────────────────────────────────────────────
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const ticket = await signTicket({
    v: 1, queueId, routineId: r.id, userId: r.user_id, workspaceId: r.workspace_id, sessionId,
    exp: Date.now() + TICKET_TTL_MS, ...(notes.length ? { notes } : {}),
    // SQEM-678 — tried once by chat-message if the provider no longer knows the model.
    ...(runModel.fallback ? { fallback: runModel.fallback, model: 'modelId' in runModel.primary ? runModel.primary.modelId : undefined } : {}),
  }, serviceKey);
  const jobId = crypto.randomUUID();
  const loadtestSecret = Deno.env.get('CHAT_LOADTEST_SECRET') ?? '';
  // ⛔ Not fetch() from here: a call from one edge function to another boots a fresh worker for the heaviest
  // module we have, and that is where load tests lost their runs (SQEM-676). The database
  // sends it through pg_net instead — the path that held up under load.
  const { error: dispatchError } = await admin.rpc('routine_dispatch_chat', {
    p_body: {
      workspaceId: r.workspace_id,
      // SQEM-678 — the workspace's default, the chosen model, or the credits (`_shared/routineModel.ts`).
      ...runModel.primary,
      systemInstruction,
      messages: [{ role: 'user', content: r.prompt }],
      jobId,
      timeZone: r.time_zone,
      webSearch: r.web_search === true,
      connectorIds,
      locale,
      routine: ticket,
    },
    // SQEM-673/676 — load tests run routines on the simulated provider; only where its secret exists.
    p_headers: loadtestSecret && isLoadtest ? { [LOADTEST_HEADER]: loadtestSecret } : {},
  });
  if (dispatchError) {
    return endHere(routineFailureText(dispatchError.message, locale), 'unreachable', false);
  }
  // chat-message answers the run from here on — also an error before the model (written into the chat there).
  console.log('[routine-run]', JSON.stringify({ outcome: 'started', waitMs, attempt: q.attempt, connectors: connectorIds.length, playbooks: playbooks.length }));
  return done(202, { started: true });
});
