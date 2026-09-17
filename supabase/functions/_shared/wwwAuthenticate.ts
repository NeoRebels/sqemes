// SQEM-429 — parsing the `WWW-Authenticate` header of an MCP server.
//
// ⚠️ **Its own file for one reason: nothing in here may reach for a runtime global.** `mcpOauth.ts`
// imports `crypto.ts`, which reads the environment through the Deno runtime — importing that from a
// Vitest file drags that global into the TypeScript program and `tsc --noEmit` then fails on a file
// nobody changed. Keeping the pure logic in an import-free module is the established shape here
// (`AGENTS.md` in the source repository, → Twins), and it is what lets the parser be tested against
// the real headers instead of only being pattern-matched as source text.

/**
 * Split a `WWW-Authenticate` value into its quoted parameters, lower-cased by name.
 *
 * ⛔ **Escaped quotes are not hypothetical, and getting this wrong fails silently.** Nifty sends
 *
 *     Bearer realm="nifty-mcp", error="invalid_request",
 *       error_description="Authorization header is required. Send \"Authorization: Bearer …\".",
 *       resource_metadata="https://mcp.niftypm.com/.well-known/oauth-protected-resource"
 *
 * A `"([^"]*)"` parser ends the third value at the first inner quote, resynchronises on the wrong
 * quote, and `resource_metadata` — the one field the OAuth flow needs — simply is not in the result.
 * No error, no exception: the caller falls back to a constructed URL and reports a 404.
 *
 * Unquoted parameters and the leading scheme token (`Bearer`) are ignored; nothing we read is ever
 * sent bare.
 */
export function parseWwwAuthenticate(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(header); m; m = re.exec(header)) {
    out[m[1].toLowerCase()] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}
