// SQEM-599 — the one set of Paraglide compiler options, shared by the Vite plugin (dev, build) and
// `npm run i18n` (CI's "output is current" check). Two copies would drift; this is the only one.
//
// ⭐ The output is COMMITTED, into supabase/functions/_shared/i18n/, because the edge functions import
// it and Deno cannot run the compiler. It is plain ESM with no package imports, so the app keeps
// working if Paraglide is ever removed — only regeneration stops (see `pm/DOCUMENTATION.md` in the source repository → Languages).
/** @type {import('@inlang/paraglide-js').CompilerOptions} */
export const i18nOptions = {
  project: './project.inlang',
  outdir: './supabase/functions/_shared/i18n',
  // Browser: the developer toggle in localStorage, else English. Server: the locale is passed per
  // call (`m.key(inputs, { locale })`), never read from global state.
  strategy: ['localStorage', 'globalVariable', 'baseLocale'],
  localStorageKey: 'sqemes_locale',
  // No AsyncLocalStorage: it would import node:async_hooks, and nothing here needs request scoping.
  disableAsyncLocalStorage: true,
  // ⛔ Pinned, not defaulted: the Vite plugin defaults to locale-modules in dev and the CLI to
  // message-modules, so the two rewrote the committed output into different shapes (seen while
  // building SQEM-599). locale-modules: one file per language instead of one per text — ~2,000 files
  // in the edge-function tree would make every diff unreadable.
  outputStructure: 'locale-modules',
  emitGitIgnore: false,
  emitReadme: false,
  emitPrettierIgnore: false,
};
