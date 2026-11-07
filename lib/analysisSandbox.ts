// SQEM-660 — runs an analysis program in the person's browser, in the isolated frame
// (public/analysis-sandbox.html → public/analysis-sandbox.js), and returns what it printed.
//
// ⛔ The guardrail this keeps (pm/VISION.md in the source repository): no code runs on our servers, skill scripts are
// never run, and the analysis a model writes for the person's OWN data runs isolated in their
// browser. "Isolated" is the frame's job and is measured, not assumed:
// - <iframe sandbox="allow-scripts"> — an opaque origin: no access to the app, its storage or the
//   session; no top navigation, no popups, no forms;
// - it has NO network at all: THIS side fetches the runtime (same origin, with the person's
//   cookies), checks every file against the SHA-256 in scripts/pyodide-manifest.json and hands the
//   bytes in — an opaque-origin frame sends no cookies, so behind any login in front of the host
//   its own requests were redirected and Python never started (measured 2026-11-06);
// - the program runs in a worker inside the frame, with fetch, XHR, WebSocket and importScripts
//   removed once Python is loaded;
// - a timeout REMOVES the frame (and with it the worker), so a runaway program ends.
//
// One frame, created on first need — or ahead of need by `preloadAnalysis()` when a table is
// attached, so Python downloads (~20 MB, measured) while the question is typed. Not on app start:
// someone who never analyses never downloads it, and a phone in data-saver mode is skipped.
//
// No Supabase import: tests load this without env vars.

import manifest from '../scripts/pyodide-manifest.json';

export interface AnalysisTable {
  /** "file.xlsx / Sheet1" or "data.csv" — what the program sees as the key in `tables`. */
  key: string;
  csv: string;
}

export interface AnalysisResult {
  ok: boolean;
  output: string;
  error?: string;
  truncated?: boolean;
  /** SQEM-660 step C — Python never started, so the program never ran (counted by the ops monitor). */
  unstarted?: boolean;
}

export const ANALYSIS_TIMEOUT_MS = 30_000;
/** How long the first start may take (downloading and starting Python) before it counts as failed. */
export const ANALYSIS_BOOT_TIMEOUT_MS = 120_000;
export const ANALYSIS_FRAME_PATH = '/analysis-sandbox.html';
export const RUNTIME_BASE = `/pyodide/${manifest.version}/`;

let frame: HTMLIFrameElement | null = null;
let booting: Promise<void> | null = null;
let seq = 0;

/** True when the device asks to save data — then nothing is loaded ahead of need. */
export function saveDataRequested(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return !!c?.saveData;
}

function removeFrame(): void {
  frame?.remove();
  frame = null;
  booting = null;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/** Every runtime file, checked against the manifest. A changed or missing file fails the start. */
async function fetchRuntime(): Promise<Record<string, ArrayBuffer>> {
  const entries = await Promise.all(Object.entries(manifest.files as Record<string, string>).map(async ([name, sha]) => {
    const res = await fetch(RUNTIME_BASE + name);
    if (!res.ok) throw new Error(`Python file ${name} could not be loaded (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    if (hex(await crypto.subtle.digest('SHA-256', buf)) !== sha) throw new Error(`Python file ${name} does not match its checksum.`);
    return [name, buf] as const;
  }));
  return Object.fromEntries(entries);
}

function ensureFrame(): Promise<void> {
  if (booting) return booting;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('aria-hidden', 'true');
  f.setAttribute('tabindex', '-1');
  f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  f.src = ANALYSIS_FRAME_PATH;
  frame = f;
  // Downloading starts with the frame, not after it: the two overlap.
  const runtime = fetchRuntime();
  runtime.catch(() => undefined);
  booting = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); removeFrame(); reject(new Error('Python did not start in time.')); }, ANALYSIS_BOOT_TIMEOUT_MS);
    const fail = (e: unknown) => { cleanup(); removeFrame(); reject(e instanceof Error ? e : new Error(String(e))); };
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== f.contentWindow) return;
      const d = ev.data as { type?: string; error?: string };
      if (d?.type === 'hello') {
        runtime.then(files => {
          // '*' because the frame's origin is opaque ("null"); it is our own frame, found by reference.
          // The buffers are transferred, not copied: ~21 MB leave this side.
          f.contentWindow?.postMessage({ type: 'boot', files }, '*', Object.values(files));
        }, fail);
      } else if (d?.type === 'ready') { cleanup(); resolve(); }
      else if (d?.type === 'boot-failed') { cleanup(); removeFrame(); reject(new Error(d.error || 'Python could not be started.')); }
    };
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
    window.addEventListener('message', onMessage);
  });
  // A failed start must not leave a rejected promise nobody awaited.
  booting.catch(() => undefined);
  document.body.appendChild(f);
  return booting;
}

/** Starts loading Python in the background, unless the device saves data. Never throws. */
export function preloadAnalysis(): void {
  if (saveDataRequested()) return;
  try { void ensureFrame(); } catch { /* the run will try again */ }
}

/** Runs one program against the given tables. Always resolves; a failure is `ok: false` with the reason. */
export async function runAnalysis(code: string, tables: AnalysisTable[], timeoutMs = ANALYSIS_TIMEOUT_MS): Promise<AnalysisResult> {
  try {
    await ensureFrame();
  } catch (e) {
    return { ok: false, output: '', error: (e as Error).message, unstarted: true };
  }
  const f = frame;
  if (!f?.contentWindow) return { ok: false, output: '', error: 'The analysis frame is not available.', unstarted: true };
  const id = `a${++seq}`;
  return new Promise<AnalysisResult>((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      removeFrame(); // ends the worker — the only reliable way to stop a runaway program
      resolve({ ok: false, output: '', error: `The program did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped.` });
    }, timeoutMs);
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== f.contentWindow) return;
      const d = ev.data as { type?: string; id?: string; ok?: boolean; output?: string; error?: string; truncated?: boolean };
      if (d?.type !== 'result' || d.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({ ok: !!d.ok, output: String(d.output ?? ''), error: d.error, truncated: !!d.truncated });
    };
    window.addEventListener('message', onMessage);
    // '*' because the frame's origin is opaque ("null"); it is our own frame, found by reference.
    f.contentWindow!.postMessage({ type: 'run', id, code, tables }, '*');
  });
}
