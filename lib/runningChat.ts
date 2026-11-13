/**
 * SQEM-657 — the answer running now, kept OUTSIDE the chat page.
 *
 * ⛔ Why a module and not page state: the page is the wrong owner for something that outlives it.
 * The send handler keeps running when the person opens another chat (the history load replaced the
 * messages, and the bubble with them) or leaves the chat page altogether (unmount: every ref and
 * state of that page is gone). The answer still finished and was stored — it simply could not be
 * seen until the very end, Stop stayed in the composer of EVERY chat and stopped this one unseen, an
 * error landed in whichever chat was open, and after a page change the composer was free again, so a
 * second question started a second answer whose history did not contain the first.
 *
 * So the page renders from here: the bubble, Stop, the error, "one answer at a time".
 *
 * ⚠️ One answer at a time is deliberate, not a limitation to lift casually: the BROWSER stores the
 * answer (`addChatMessage` at the end of the send handler). A second send would abort the first and
 * lose it.
 *
 * ⚠️ A reload or a closed tab empties this module, like everything else in the tab — out of scope.
 *
 * No Supabase import: tests must load this without env vars (it throws at import time there).
 */

export interface RunningMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  continuing?: boolean;
  analysing?: boolean; // SQEM-660 — a program runs in this browser right now
  resuming?: boolean; // SQEM-686 — the worker died; the answer goes on from its last finished round
  model?: string;
}

export interface RunningAnswer<M extends RunningMsg = RunningMsg> {
  /** null while a new chat's row is still being created. */
  sessionId: string | null;
  /** Set once the request is about to be sent; Stop does nothing before that. */
  jobId: string | null;
  assistantMsgId: string | null;
  userMsg: M;
  model: string;
  /** The WHOLE text so far (deltas are cumulative — replaced, never appended). */
  text: string;
  continuing: boolean;
  analysing: boolean;
  resuming: boolean;
  stopped: boolean;
  controller: AbortController;
}

export interface FinishedAnswer<M extends RunningMsg = RunningMsg> { sessionId: string; msg: M }
export interface FailedAnswer { sessionId: string | null; message: string; code: string | null }

export interface RunningChatState<M extends RunningMsg = RunningMsg> {
  running: RunningAnswer<M> | null;
  /** The last answer that ended, until the page of its chat has taken it into its messages. */
  finished: FinishedAnswer<M> | null;
  /** The last error, shown only in its own chat. */
  failed: FailedAnswer | null;
}

let state: RunningChatState<RunningMsg> = { running: null, finished: null, failed: null };
const listeners = new Set<() => void>();

function set(next: Partial<RunningChatState<RunningMsg>>) {
  state = { ...state, ...next };
  listeners.forEach(l => l());
}

export function subscribeRunningChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A new object on every change — what `useSyncExternalStore` needs. */
export function getRunningChat<M extends RunningMsg>(): RunningChatState<M> {
  return state as RunningChatState<M>; // one module-wide answer; the page names its message type
}

/** Starts an answer; clears the previous error (a new send is the moment it stops being news). */
export function startRunning<M extends RunningMsg>(init: { sessionId: string | null; userMsg: M; model: string; controller: AbortController }): RunningAnswer<M> {
  const run: RunningAnswer<M> = { ...init, jobId: null, assistantMsgId: null, text: '', continuing: false, analysing: false, resuming: false, stopped: false };
  set({ running: run, failed: null });
  return run;
}

/**
 * Changes the running answer — only if `run` is still the one running: a stale send handler (its
 * answer was abandoned by New chat) must not write into the next one.
 *
 * ⚠️ Mutated in place, on purpose: the send handler and the page (Stop) hold the SAME object, so a
 * Stop set from the page is what the handler's catch reads. The state wrapper is replaced instead —
 * that new object is what tells `useSyncExternalStore` to render.
 */
export function updateRunning<M extends RunningMsg>(run: RunningAnswer<M>, patch: Partial<Pick<RunningAnswer<M>, 'sessionId' | 'jobId' | 'assistantMsgId' | 'model' | 'text' | 'continuing' | 'analysing' | 'resuming' | 'stopped'>>): void {
  if (state.running !== run) return;
  Object.assign(run, patch);
  set({});
}

/** The answer ended with a message to show (a result, or the text kept on Stop). */
export function finishRunning<M extends RunningMsg>(run: RunningAnswer<M>, msg: M): void {
  if (state.running !== run) return;
  set({ running: null, finished: run.sessionId ? { sessionId: run.sessionId, msg } : null });
}

/** The answer failed; the error belongs to its chat. */
export function failRunning(run: RunningAnswer<RunningMsg>, message: string, code: string | null): void {
  if (state.running !== run) return;
  set({ running: null, failed: { sessionId: run.sessionId, message, code } });
}

/** The answer ended without anything to show (an abort that was not a Stop). No-op if already ended. */
export function endRunning(run: RunningAnswer<RunningMsg>): void {
  if (state.running !== run) return;
  set({ running: null });
}

/** The page of the finished answer's chat has taken it into its messages. */
export function takeFinished(msgId: string): void {
  if (state.finished?.msg.id === msgId) set({ finished: null });
}

export function clearFailed(): void {
  if (state.failed) set({ failed: null });
}

/** Tests only. */
export function resetRunningChat(): void {
  state = { running: null, finished: null, failed: null };
  listeners.forEach(l => l());
}

/** The bubble of the running answer: "thinking" until the first text, then the text so far. */
export function runningBubble<M extends RunningMsg>(run: RunningAnswer<M>): RunningMsg | null {
  if (!run.assistantMsgId) return null;
  return { id: run.assistantMsgId, role: 'assistant', content: run.text, pending: !run.text, continuing: run.continuing, analysing: run.analysing, resuming: run.resuming, model: run.model };
}

/**
 * What the chat with id `sessionId` shows: its messages, plus — if the answer running now belongs to
 * it — its own question (when the history load came before that was stored) and the bubble, plus a
 * finished answer of this chat that is not in the messages yet. Matched by id, so the stored copy of
 * either never shows twice.
 */
export function withRunningAnswer<M extends RunningMsg>(messages: M[], s: RunningChatState<M>, sessionId: string | null): M[] {
  const ids = new Set(messages.map(m => m.id));
  const extra: M[] = [];
  if (s.finished && s.finished.sessionId === sessionId && sessionId !== null && !ids.has(s.finished.msg.id)) {
    extra.push(s.finished.msg);
  }
  const run = s.running;
  if (run && run.sessionId === sessionId) {
    if (!ids.has(run.userMsg.id)) extra.push(run.userMsg);
    const bubble = runningBubble(run);
    if (bubble && !ids.has(bubble.id)) extra.push(bubble as M);
  }
  return extra.length ? [...messages, ...extra] : messages;
}
