// SQEM-301 — telling a stale build apart from a real crash.
//
// The routes are `React.lazy` and their chunks carry a content hash in the filename, so a deploy
// replaces those filenames. Anyone holding the page open when that happens asks for a file that no
// longer exists on the next route change; the dynamic import throws and `ErrorBoundary` catches it.
//
// **Nothing is broken — the person is simply holding a version that no longer exists.** Until this
// existed they were shown a red triangle, "Something went wrong" and a URL in monospace, after
// every single production deploy.
//
// ⛔ **Renaming the error screen instead would have been worse than leaving it.** A real crash would
// then also claim there had been an update and send the person into a reload that cannot help. **A
// message that says the same thing about everything says nothing.** So the stale build is
// *identified*, and everything else keeps the error screen it deserves.

/**
 * The browsers disagree on the wording, which is the whole reason this is a named, tested function
 * and not a condition inlined at the call site: somebody adding a browser later should find one
 * place, not three.
 *
 * | Browser | What it says |
 * |---|---|
 * | Chrome, Edge | `Failed to fetch dynamically imported module` |
 * | Firefox | `error loading dynamically imported module` |
 * | Safari | `Importing a module script failed` |
 * | Vite (CSS preload) | `Unable to preload CSS for` |
 */
const STALE_BUILD_MESSAGES = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css for',
];

/**
 * Is this the deploy-replaced-the-chunk case rather than a defect?
 *
 * ⚠️ Deliberately matched on the message. There is no error *type* for this — every browser throws
 * a plain `TypeError` and only the text distinguishes it. Bundlers that ship a `ChunkLoadError`
 * name are covered too, since checking for it costs one comparison and outlives the text matching
 * if a browser ever adopts it.
 *
 * ⛔ Conservative on purpose: an unrecognised message is treated as a **real error**. Mistaking a
 * crash for an update tells somebody to reload when reloading will not help, and hides a defect
 * behind a cheerful screen. The reverse mistake merely shows an honest error after a deploy.
 */
export function isStaleBuildError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return STALE_BUILD_MESSAGES.some(m => message.includes(m));
}
