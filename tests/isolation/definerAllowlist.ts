/**
 * SQEM-504 — every SECURITY DEFINER function in `public` that a client role may EXECUTE (trigger
 * functions excluded: they cannot be called over the API).
 *
 * ⛔ **The set is checked for equality.** A new definer function with client rights makes the suite
 * fail until it is listed here with a reason — or, far more often, until its migration revokes it
 * (SQEM-503; the rule is in docs/ai/rules/database-migrations.md in the source repository). A definer
 * function bypasses RLS; "callable by clients" has to be a decision, never a default.
 *
 * `probe` is what tenant B's member tries with A's ids. `zero` = the statement must count 0 rows;
 * `error` = the call must be refused; `zeroOrError` = either.
 */
import { A, USERS } from './ownership';

const A_ONLY_ME = 'aaaaaaaa-0000-4000-8000-00000000a002';
const A_PERSONA = 'aaaaaaaa-0000-4000-8000-00000000a101';
const A_FILE = 'aaaaaaaa-0000-4000-8000-00000000a301';
const A_SHARED_CHAT = 'aaaaaaaa-0000-4000-8000-00000000a402';

export interface DefinerEntry {
  why: string;
  probe?: { sql: string; expect: 'zero' | 'error' | 'zeroOrError' };
}

export const DEFINER_ALLOWLIST: Record<string, DefinerEntry> = {
  accept_invitation: {
    why: 'app: accepting an invitation; matches the LOGIN e-mail of auth.uid() (SQEM-491)',
    probe: { sql: `select public.accept_invitation((select token from public.invitations where email = 'pending-a@isolation.invalid'))`, expect: 'error' },
  },
  accessible_file_ids: {
    why: 'RLS helper (workspace_files_select, SQEM-512); the set form of can_access_file for auth.uid()',
    probe: { sql: `select count(*) from public.accessible_file_ids() f where f = '${A_FILE}'`, expect: 'zero' },
  },
  can_access_file: {
    why: 'RLS helper (storage + workspace_files); evaluates auth.uid()',
    probe: { sql: `select count(*) from (select public.can_access_file('${A_FILE}', '${A}', '${USERS.a1}') v) x where v`, expect: 'zero' },
  },
  can_access_persona: {
    why: 'RLS helper (personas); evaluates auth.uid()',
    probe: { sql: `select count(*) from (select public.can_access_persona('${A_PERSONA}', '${USERS.a1}') v) x where v`, expect: 'zero' },
  },
  can_access_template: {
    why: 'RLS helper (prompts); evaluates auth.uid()',
    probe: { sql: `select count(*) from (select public.can_access_template('${A_ONLY_ME}', '${A}', '${USERS.a1}') v) x where v`, expect: 'zero' },
  },
  count_restricted_content_for_member: {
    why: 'app (member removal dialog); refuses unless the caller is admin of that workspace',
    probe: { sql: `select * from public.count_restricted_content_for_member('${A}', '${USERS.a1}')`, expect: 'error' },
  },
  create_workspace: {
    why: 'app: create a workspace for yourself; takes no tenant id',
  },
  get_user_role: {
    why: 'RLS helper; answers only for auth.uid()',
    probe: { sql: `select count(*) from (select public.get_user_role('${A}') r) x where r is not null`, expect: 'zero' },
  },
  get_user_workspace_ids: {
    why: 'RLS helper; answers only for auth.uid()',
    probe: { sql: `select count(*) from public.get_user_workspace_ids() w where w = '${A}'`, expect: 'zero' },
  },
  handover_content_from_member: {
    why: 'app (member removal); refuses unless the caller is admin of that workspace',
    probe: { sql: `select public.handover_content_from_member('${A}', '${USERS.a2}')`, expect: 'error' },
  },
  increment_template_usage: {
    why: 'app: marketplace "Add to workspace". ⚠️ Any signed-in user can raise any listing\'s counter (ranking only, no data) — accepted in SQEM-503, revisit if the counter ever decides anything',
  },
  is_sqemes_admin: {
    why: 'RLS helper; answers only for auth.uid()',
    probe: { sql: `select count(*) from (select public.is_sqemes_admin() v) x where v`, expect: 'zero' },
  },
  release_restricted_content: {
    why: 'app (member removal); refuses unless the caller is admin of that workspace',
    probe: { sql: `select * from public.release_restricted_content('${A}', '${USERS.a1}')`, expect: 'error' },
  },
  set_workspace_managed: {
    why: 'app (Sqemes admin screen); refuses unless the caller is a Sqemes admin (SQEM-488/489)',
    probe: { sql: `select public.set_workspace_managed('${A}', false)`, expect: 'error' },
  },
  unshare_chat_session: {
    why: 'app (admin withdraws a shared chat); refuses unless the caller is admin of the session\'s workspace',
    probe: { sql: `select public.unshare_chat_session('${A_SHARED_CHAT}')`, expect: 'error' },
  },
  workspace_file_usage: {
    why: 'app (Files page counts); membership-checked (SQEM-234)',
    probe: { sql: `select count(*) from public.workspace_file_usage('${A}')`, expect: 'zeroOrError' },
  },
};
