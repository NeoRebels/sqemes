/**
 * Monitoring module — structured error reporting (SQEM-114).
 *
 * Sends handled + unhandled errors to Sentry when VITE_SENTRY_DSN is set; otherwise it degrades to
 * structured console logging (so local dev / previews without a DSN keep working). Errors-only —
 * no performance tracing or session replay — to keep it lightweight and the CSP surface minimal.
 *
 * Usage:
 *   import { initMonitoring, logError, setMonitoringUser } from './lib/monitoring';
 *   initMonitoring(); // call once in index.tsx
 */
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN;
const SENTRY_ENABLED = !!DSN;

// Separate prod from staging/preview in Sentry without an extra env var.
const environment =
  typeof window !== 'undefined' && window.location.hostname === 'app.sqemes.com'
    ? 'production'
    : 'staging';

export function initMonitoring() {
  if (SENTRY_ENABLED) {
    // Sentry's default integrations already capture window.onerror + unhandledrejection, so we
    // don't add our own listeners here (that would double-report). Explicit logError() calls in the
    // app's catch blocks go to captureException below.
    Sentry.init({
      dsn: DSN,
      environment,
      // Errors only: no browserTracing / replay integrations, no tracesSampleRate.
    });
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

  if (SENTRY_ENABLED) {
    Sentry.captureException(error instanceof Error ? error : new Error(message), { extra });
  }
}

export function setMonitoringUser(userId: string, email?: string) {
  console.info(JSON.stringify({ level: 'info', event: 'user_identified', userId, email }));
  if (SENTRY_ENABLED) Sentry.setUser({ id: userId, email });
}

export function clearMonitoringUser() {
  if (SENTRY_ENABLED) Sentry.setUser(null);
}

// SQEM-114 build marker: force a clean rebuild so the Sentry-wired monitoring chunk deploys.
