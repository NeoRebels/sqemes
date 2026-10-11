/**
 * SQEM-504 — for every table in `public`: which rows belong to tenant A, evaluated as `postgres`.
 *
 * ⛔ **Every table must be classified here.** A new table makes the suite fail until somebody decides
 * how its rows map to a tenant — that decision is the point; a table nobody classified is a table
 * nobody checked.
 *
 * ⚠️ The predicate runs with RLS OFF (as postgres) on purpose. Evaluated as B, a join to A's sessions
 * would come back empty and hide a leak of A's messages — the probe would "pass" by not looking.
 */
export const A = 'aaaaaaaa-0000-4000-8000-0000000000aa';
export const B = 'bbbbbbbb-0000-4000-8000-0000000000bb';
export const USERS = {
  a1: 'aaaaaaaa-0000-4000-8000-0000000000a1', // admin of A
  a2: 'aaaaaaaa-0000-4000-8000-0000000000a2', // member of A
  b1: 'bbbbbbbb-0000-4000-8000-0000000000b1', // admin of B
  b2: 'bbbbbbbb-0000-4000-8000-0000000000b2', // member of B
};
const A_USERS = `('${USERS.a1}', '${USERS.a2}')`;

export interface Ownership {
  /** SQL predicate on alias `t`: the row belongs to tenant A. */
  ownedByA: string;
  /** Rows of A that another tenant may legitimately see (public by design). */
  publicByDesign?: string;
  /** The seed may leave this table empty for A — with the reason. Otherwise empty = test fails. */
  mayBeEmpty?: string;
  /** For the insert probe: columns to overwrite when B tries to plant a copy of A's row. */
  insertAs?: 'workspace';
}

const ws = (col = 'workspace_id'): Ownership => ({ ownedByA: `t.${col} = '${A}'`, insertAs: 'workspace' });
const byUser = (col: string): Ownership => ({ ownedByA: `t.${col} in ${A_USERS}` });

export const OWNERSHIP: Record<string, Ownership> = {
  // Tenant data, keyed by workspace.
  chat_sessions: ws(),
  deleted_workspaces_audit: ws(),
  invitations: ws(),
  mcp_auth_codes: ws(),
  mcp_refresh_tokens: ws(),
  persona_access: ws(),
  personas: ws(),
  prompts: ws(),
  rate_limit_counters: ws(),
  sqemes_api_keys: ws(),
  template_access: ws(),
  workspace_api_keys: ws(),
  workspace_connectors: ws(),
  workspace_file_texts: ws(),
  workspace_files: ws(),
  workspace_groups: ws(),
  workspace_members: ws(),
  workspaces: { ownedByA: `t.id = '${A}'` },
  library_templates: {
    ...ws(),
    publicByDesign: `t.status = 'published' and t.published`,
  },

  // Tenant data, keyed through a parent.
  chat_messages: { ownedByA: `t.session_id in (select id from public.chat_sessions where workspace_id = '${A}')` },
  persona_templates: { ownedByA: `t.persona_id in (select id from public.personas where workspace_id = '${A}')` },
  workspace_group_members: { ownedByA: `t.group_id in (select id from public.workspace_groups where workspace_id = '${A}')` },
  mcp_call_counters: { ownedByA: `t.key_id in (select id from public.sqemes_api_keys where workspace_id = '${A}')` },
  mcp_rate_counters: { ownedByA: `t.key_id in (select id from public.sqemes_api_keys where workspace_id = '${A}')` },

  // Per-person data of A's members.
  external_chat_history: byUser('user_id'),
  legal_acceptances: byUser('user_id'),
  user_prompt_favorites: byUser('user_id'),
  user_persona_favorites: byUser('user_id'),
  library_template_votes: byUser('user_id'),
  library_template_reports: byUser('reporter_id'),
  profiles: byUser('id'),

  // Platform rows no tenant may see (Sqemes admins / service role only).
  marketplace_publishers: { ownedByA: 'true' },
  mcp_oauth_clients: { ownedByA: 'true' },
  marketplace_publisher_config: {
    ownedByA: 'true',
    mayBeEmpty: 'single-row instance config of a self-host publisher; not present on a fresh database',
  },
};
