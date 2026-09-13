/**
 * SQEM-378/398 — the browser's door to the one library instruction.
 *
 * `LIBRARY_SYSTEM_PROMPT` lives in `supabase/functions/_shared/libraryPrompt.ts` (import-free, read by
 * the MCP server, `chat-message` and the browser). Until SQEM-398 the browser reached it through a
 * re-export in `constants.ts` — and `constants.ts` is also loaded by the Vercel serverless function
 * `api/extension-config.ts`, whose runtime cannot follow a `.ts` specifier (see the note there). So
 * the re-export lives here, in a module only the browser bundle imports.
 */
export { LIBRARY_SYSTEM_PROMPT } from '../supabase/functions/_shared/libraryPrompt.ts';
