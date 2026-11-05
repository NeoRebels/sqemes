/**
 * SQEM-649 — one chat answer across several invocations of `chat-message`.
 *
 * A worker lives ~400 s (`_shared/chatTimeouts.ts`), and a task across several connectors ("everything
 * from mail, calendar, Nifty and TANSS") needs more than one worker's worth of rounds. So when the
 * time budget of one invocation is used up and the chain still has time, the provider loop stops at a
 * round boundary (`ChatContinuation`), and `chat-message` calls ITSELF with the loop's state in the
 * request body. The new invocation re-reads the API key and the connector tokens from the database
 * and carries on in the same loop, under the same `jobId`.
 *
 * ⭐ **Measured before it was built** (2026-11-04, a temporary probe function): a self-call
 * lands on a NEW worker with its own ~400 s — a chain of three ran past 700 s — and a 20 MB body is
 * read in under 250 ms. The docs' "one worker can serve multiple requests" did not apply.
 *
 * ⛔ **The state travels in the request, never in the database.** It holds tool results — search
 * results, page contents, mail — and the privacy policy (section 4) says those are not stored. A
 * table with a TTL would have needed a new policy version and re-acceptance by every user.
 *
 * ⛔ **No secret is in it.** The API key and the connector tokens are re-read from the database by
 * the next invocation; the person's JWT travels only in the `Authorization` header of the self-call.
 * `containsSecret` is the runtime check, `tests/unit/chatContinuation.test.ts` the standing one.
 *
 * ⛔ **It is signed.** The body is under the caller's control like any request body, and the state
 * carries the round counters, the time the chain started and what was already charged — a forged
 * one would buy unlimited rounds on funded credits. HMAC-SHA256 with the service role key, which only
 * this project's functions hold; bound to the person and the job.
 *
 * Pure apart from WebCrypto (global in Deno and in Node), so tests/unit can drive it.
 */

import { CHAT_CHAIN_MS } from './chatTimeouts.ts';

export { CHAT_CHAIN_MS };

/** A chain longer than this is a bug, not a long task — refused whatever the clock says. */
export const MAX_GENERATIONS = 20;

/** How long a signed state stays acceptable after the chain started (chain + one call + margin). */
export const STATE_TTL_MS = CHAT_CHAIN_MS + 360_000;

/** What a provider loop hands over at a round boundary. `convo` is the provider's own message list. */
export interface LoopSnapshot {
  convo: unknown[];
  /** The answer text written so far (all rounds), so the next invocation continues the same reply. */
  answer: string;
  /** Provider-specific bits: the connector labels still active, the ones dropped (Claude, OpenAI). */
  activeConnectorNames?: string[] | null;
  droppedConnectors?: string[];
}

/**
 * Thrown by a provider loop when the invocation's time is up and the chain may go on. Not an error:
 * `runAndBroadcast` catches it before its error branch and hands the state over.
 */
export class ChatContinuation extends Error {
  constructor(public readonly loop: LoopSnapshot, public readonly totalTokens = 0) {
    super('chat continuation');
    this.name = 'ChatContinuation';
  }
}

/** The original request, as far as the next invocation needs it. Signed, so it cannot be changed. */
export interface ContinuationRequest {
  modelId?: string;
  funded: boolean;
  systemInstruction?: string;
  timeZone?: string;
  connectorIds?: string[];
  webSearch?: boolean;
  locale?: string;
}

export interface ContinuationState {
  v: 1;
  jobId: string;
  userId: string;
  workspaceId: string;
  /** When the person's message arrived — the 10 minutes count from here, across every invocation. */
  chainStartedAt: number;
  /** 1 = the person's own request; the first self-call is 2. */
  gen: number;
  request: ContinuationRequest;
  provider: string;
  loop: LoopSnapshot;
  /**
   * Funded: tokens used but not yet charged. Credits are whole thousands rounded UP per debit, so
   * charging every invocation in full would add up to one credit per hand-over; the remainder below a
   * thousand rides along and is charged with the rest at the end.
   */
  tokenCarry?: number;
  /** The tool runtime's counters (`ToolStats`) and the native-call mark (`nativeCallsSeen`). */
  tools: { stats: Record<string, unknown>; nativeCallsSeen?: number; callCounts?: Record<string, number> } | null;
  /** What the answer collected so far: "Used" chips, change cards, sources, files, unreachable connectors. */
  collected: {
    loadedTemplateIds: string[];
    libraryChanges: unknown[];
    webSources: { queries: unknown[]; pages: unknown[] };
    webAllowanceExhausted: boolean;
    generatedFiles: unknown[];
    unreachable: string[];
    /** SQEM-651 — connectors the model fetched during the answer (display names), for the line under it. */
    fetchedConnectors?: string[];
  };
}

export interface SignedContinuation { state: string; sig: string }

/** Split the tokens of one invocation into what is charged now (whole thousands) and what rides on. */
export function splitTokens(tokens: number): { charge: number; carry: number } {
  const charge = Math.floor(Math.max(0, tokens) / 1000) * 1000;
  return { charge, carry: Math.max(0, tokens) - charge };
}

/** May another invocation still be started? */
export function canContinue(chainStartedAt: number, gen: number, now: number): boolean {
  return gen < MAX_GENERATIONS && now - chainStartedAt < CHAT_CHAIN_MS;
}

/**
 * The time budget of ONE invocation: its own budget, but never past the chain's end — so the round
 * after the chain's 10 minutes is the answer rather than one more hand-over.
 */
export function invocationDeadline(invocationStartedAt: number, chainStartedAt: number, budgetMs: number): number {
  return Math.min(invocationStartedAt + budgetMs, chainStartedAt + CHAT_CHAIN_MS);
}

/** True when any of the given secrets (non-empty) appears in the serialized state. */
export function containsSecret(serialized: string, secrets: (string | null | undefined)[]): boolean {
  return secrets.some(s => typeof s === 'string' && s.length >= 8 && serialized.includes(s));
}

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`sqem649:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison, so the signature check does not leak how much of a guess was right. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signContinuation(state: ContinuationState, secret: string): Promise<SignedContinuation> {
  if (!secret) throw new Error('no signing secret');
  const serialized = JSON.stringify(state);
  return { state: serialized, sig: await hmac(secret, serialized) };
}

export type OpenResult = { ok: true; state: ContinuationState } | { ok: false; reason: string };

/**
 * Verify and parse a state that arrived in a request. ⛔ Every check is a refusal, never a repair:
 * a state that does not verify is not resumed in any form.
 */
export async function openContinuation(
  envelope: unknown, secret: string, userId: string, now: number,
): Promise<OpenResult> {
  const e = envelope as Partial<SignedContinuation> | null;
  if (!secret) return { ok: false, reason: 'no signing secret' };
  if (!e || typeof e.state !== 'string' || typeof e.sig !== 'string') return { ok: false, reason: 'malformed' };
  if (!sameHex(await hmac(secret, e.state), e.sig)) return { ok: false, reason: 'signature' };
  let state: ContinuationState;
  try { state = JSON.parse(e.state); } catch { return { ok: false, reason: 'malformed' }; }
  if (state?.v !== 1) return { ok: false, reason: 'version' };
  if (state.userId !== userId) return { ok: false, reason: 'user' };
  if (!(state.gen >= 2 && state.gen <= MAX_GENERATIONS)) return { ok: false, reason: 'generation' };
  if (!(now - state.chainStartedAt < STATE_TTL_MS)) return { ok: false, reason: 'expired' };
  return { ok: true, state };
}
