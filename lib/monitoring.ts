/**
 * Monitoring module — structured error reporting (SQEM-114).
 *
 * Sends handled + unhandled errors to Sentry when VITE_SENTRY_DSN is set; otherwise it degrades to
 * structured console logging (so local dev / previews without a DSN keep working). Errors-only —
 * no performance tracing or session replay — to keep it lightweight and the CSP surface minimal.
 *
 * Usage:
 *   import { initMonitoring, logError, setMonitoringUser } from './lib/monitoring';
 *   initMonitoring(); // call once in index.tsx, before anything else runs
 *
 * SQEM-542 — Sentry is loaded AFTER the first render, not with the app. It is ~29 KB gzip, and in
 * production it used to be preloaded and initialised before anything was on screen. Until it has
 * loaded, errors are not lost: our own `error`/`unhandledrejection` listeners and every `logError` /
 * `setMonitoringUser` call go into a small buffer, which is handed to Sentry the moment it is up.
 * ⚠️ The buffer is capped (`MAX_PENDING`) so a crash loop before load cannot grow it without bound;
 * the first errors are the ones worth keeping, so later ones are dropped, not earlier ones.
 */
import type * as SentryModule from '@sentry/react';

type SentryApi = typeof SentryModule;
type Pending =
  | { kind: 'error'; error: unknown; extra?: Record<string, unknown> }
  | { kind: 'user'; user: { id: string; email?: string } | null };

const DSN = import.meta.env.VITE_SENTRY_DSN;
const SENTRY_ENABLED = !!DSN;
export const MAX_PENDING = 20;

let sentry: SentryApi | null = null;
const pending: Pending[] = [];
let removeEarlyListeners: (() => void) | null = null;

// Separate prod from staging/preview in Sentry without an extra env var.
const environment =
  typeof window !== 'undefined' && window.location.hostname === 'app.sqemes.com'
    ? 'production'
    : 'staging';

function queue(item: Pending) {
  if (item.kind === 'user') {
    // Only the latest identity matters; replace instead of stacking.
    const i = pending.findIndex(p => p.kind === 'user');
    if (i !== -1) pending.splice(i, 1);
    pending.push(item);
    return;
  }
  if (pending.filter(p => p.kind === 'error').length < MAX_PENDING) pending.push(item);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function flush(api: SentryApi) {
  for (const item of pending.splice(0)) {
    if (item.kind === 'user') api.setUser(item.user);
    else api.captureException(asError(item.error), { extra: item.extra });
  }
}

/** Loads Sentry, initialises it and replays the buffer. Exported for tests. */
export async function loadSentry(): Promise<void> {
  try {
    const api = await import('@sentry/react');
    // Sentry's default integrations capture window.onerror + unhandledrejection from here on, so our
    // early listeners step aside — keeping both would report every error twice.
    api.init({
      dsn: DSN,
      environment,
      // Errors only: no browserTracing / replay integrations, no tracesSampleRate.
    });
    removeEarlyListeners?.();
    removeEarlyListeners = null;
    sentry = api;
    flush(api);
  } catch (err) {
    // A blocked or failed chunk must not take the app down; the console still has everything.
    console.error(JSON.stringify({ level: 'error', message: 'Sentry failed to load', detail: String(err) }));
  }
}

export function initMonitoring() {
  if (SENTRY_ENABLED) {
    const onError = (event: ErrorEvent) => queue({ kind: 'error', error: event.error ?? event.message, extra: { context: 'window.onerror' } });
    const onRejection = (event: PromiseRejectionEvent) => queue({ kind: 'error', error: event.reason, extra: { context: 'unhandledrejection' } });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    removeEarlyListeners = () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
    // After the first paint, at the latest after 3 s.
    const start = () => { void loadSentry(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 3000 });
    else window.setTimeout(start, 1);
    return;
  }

  // Fallback when Sentry is disabled — keep structured console logs for unhandled errors.
  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, { context: 'unhandledrejection' });
  });
  window.addEventListener('error', (event) => {
    logError(event.error ?? event.message, { context: 'window.onerror' });
  });
}

export function logError(error: unknown, extra?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Structured log — easy to parse in a log aggregator, and the only sink when Sentry is off.
  console.error(JSON.stringify({
    level: 'error',
    message,
    stack,
    timestamp: new Date().toISOString(),
    ...extra,
  }));

  if (!SENTRY_ENABLED) return;
  if (sentry) sentry.captureException(asError(error), { extra });
  else queue({ kind: 'error', error, extra });
}

export function setMonitoringUser(userId: string, email?: string) {
  console.info(JSON.stringify({ level: 'info', event: 'user_identified', userId, email }));
  if (!SENTRY_ENABLED) return;
  if (sentry) sentry.setUser({ id: userId, email });
  else queue({ kind: 'user', user: { id: userId, email } });
}

export function clearMonitoringUser() {
  if (!SENTRY_ENABLED) return;
  if (sentry) sentry.setUser(null);
  else queue({ kind: 'user', user: null });
}
