// SQEM-523 — MCP tool annotations (spec 2025-03-26), DERIVED from the capability that already gates the
// tool (`TOOL_CAPABILITY` in mcp-server). A hint is what a client shows a person before it asks — or
// does not ask — for confirmation, so it must never say "read-only" about a tool the gate treats as a
// write. Deriving it from the same table is what keeps the two from drifting; a hand-written hint per
// tool would be the third list SQEM-332 warns about.
//
// MCP client guidelines ask for a title, `readOnlyHint`, and `destructiveHint` on anything
// that changes data. Pure: imported by mcp-server, tested directly.
export type ToolCapability = 'read' | 'create' | 'update' | 'delete';

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** `finalize_upload` returns the already-registered file when called again. */
const IDEMPOTENT_CREATE = new Set(['finalize_upload']);
/** Reaches outside Sqemes: fetches an archive from GitHub. Every other tool touches only the workspace. */
const OPEN_WORLD = new Set(['import_skill_from_url']);

export function toolAnnotations(name: string, capability: ToolCapability, title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: capability === 'read',
    // update overwrites (content, a route's condition); delete removes. create only adds.
    destructiveHint: capability === 'update' || capability === 'delete',
    idempotentHint: capability !== 'create' || IDEMPOTENT_CREATE.has(name),
    openWorldHint: OPEN_WORLD.has(name),
  };
}
