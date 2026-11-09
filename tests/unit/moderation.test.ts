import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isModerator, moderatorCandidates, submitsOnSave, reviewBadgeOf, changeNeedsReview, changedFields, accessRowsOf } from '../../lib/moderation';
import { en, de } from './i18nText';

/** SQEM-666 — moderation of new playbooks and personas: the rules the app mirrors, and where they live. */

const read = (p: string) => readFileSync(p, 'utf8');
const MIGRATION = read('supabase/migrations/20261108200000_sqem666_moderation.sql');

describe('who moderates', () => {
  it('admins always, editors when listed, members never', () => {
    expect(isModerator('admin', 'a', [])).toBe(true);
    expect(isModerator('editor', 'e', ['e'])).toBe(true);
    expect(isModerator('editor', 'e', new Set(['x']))).toBe(false);
    expect(isModerator('member', 'm', ['m'])).toBe(false);
  });
  it('the picker offers editors and admins, never members', () => {
    const people = [{ id: '1', role: 'admin' }, { id: '2', role: 'editor' }, { id: '3', role: 'member' }];
    expect(moderatorCandidates(people).map(p => p.id)).toEqual(['1', '2']);
  });
});

describe('saving and badges', () => {
  it('saving submits only for the owner of something not released who chose more than only me', () => {
    const draft = { state: 'draft' as const, note: null };
    expect(submitsOnSave(draft, true, 'everyone')).toBe(true);
    expect(submitsOnSave(draft, true, 'restricted')).toBe(true);
    expect(submitsOnSave(draft, true, 'private')).toBe(false);
    expect(submitsOnSave({ state: 'rejected', note: 'x' }, true, 'everyone')).toBe(true);
    expect(submitsOnSave({ state: 'pending', note: null }, true, 'everyone')).toBe(false);
    expect(submitsOnSave(draft, false, 'everyone')).toBe(false);
    expect(submitsOnSave(undefined, true, 'everyone')).toBe(false);
  });
  it('the owner sees every state; a moderator only "pending"; anyone else nothing', () => {
    expect(reviewBadgeOf({ state: 'draft', note: null }, true, false)).toBe('draft');
    expect(reviewBadgeOf({ state: 'draft', note: null }, false, true)).toBeNull();
    expect(reviewBadgeOf({ state: 'pending', note: null }, false, true)).toBe('pending');
    expect(reviewBadgeOf({ state: 'pending', note: null }, false, false)).toBeNull();
  });
});

describe('the database carries the rule', () => {
  it('⛔ all four access functions consult the review state before the access rows', () => {
    for (const fn of ['can_access_template', 'mcp_accessible_template_ids', 'can_access_persona', 'mcp_accessible_persona_ids']) {
      const body = MIGRATION.slice(MIGRATION.indexOf(`function public.${fn}(`));
      const end = body.indexOf('$$;');
      expect(body.slice(0, end), fn).toMatch(/when 'pending' then public\.is_workspace_moderator\(/);
      expect(body.slice(0, end), fn).toMatch(/when 'draft' then false\s+when 'rejected' then false/);
    }
  });
  it('⛔ the tenant boundary of SQEM-505/525 survives in both RLS helpers, and the migration checks it itself', () => {
    const tpl = MIGRATION.slice(MIGRATION.indexOf('function public.can_access_template('));
    expect(tpl.slice(0, tpl.indexOf('$$;'))).toMatch(/p_workspace_id in \(select public\.get_user_workspace_ids\(\)\)/);
    const per = MIGRATION.slice(MIGRATION.indexOf('function public.can_access_persona('));
    expect(per.slice(0, per.indexOf('$$;'))).toMatch(/pe\.workspace_id not in \(select public\.get_user_workspace_ids\(\)\)/);
    expect(MIGRATION).toMatch(/SQEM-666 self-check: can_access_template lost the SQEM-505 tenant boundary/);
  });
  it('the state is set on insert for every writer and changed by clients only through the two functions', () => {
    expect(MIGRATION).toMatch(/create trigger guard_review_state before insert or update on public\.prompts/);
    expect(MIGRATION).toMatch(/create trigger guard_review_state before insert or update on public\.personas/);
    expect(MIGRATION).toMatch(/if \(select auth\.uid\(\)\) is not null and coalesce\(current_setting\('sqemes\.review', true\), ''\) <> 'on' then/);
    // ⛔ Fires after guard_client_owned_columns, which sets created_by — by name order.
    expect('guard_client_owned_columns' < 'guard_review_state').toBe(true);
  });
  it('moderators: editors and admins only, a demotion removes them, leaving removes them by key', () => {
    expect(MIGRATION).toMatch(/m\.role in \('admin', 'editor'\)/);
    expect(MIGRATION).toMatch(/create trigger drop_demoted_moderator after update of role on public\.workspace_members/);
    expect(MIGRATION).toMatch(/references public\.workspace_members \(workspace_id, user_id\) on delete cascade/);
  });
  it('deciding asks is_workspace_moderator; submitting runs as the owner', () => {
    const decide = MIGRATION.slice(MIGRATION.indexOf('function public.decide_review('));
    expect(decide.slice(0, decide.indexOf('$$;'))).toMatch(/security definer[\s\S]*is_workspace_moderator\(v_ws, \(select auth\.uid\(\)\)\)/);
    const submit = MIGRATION.slice(MIGRATION.indexOf('function public.submit_for_review('));
    expect(submit.slice(0, submit.indexOf('$$;'))).toMatch(/security invoker[\s\S]*v_owner is distinct from \(select auth\.uid\(\)\)/);
  });
});

describe('the app', () => {
  it('⛔ review states are read in their own query, never in the list select (the app goes live before the migration)', () => {
    expect(read('lib/api/prompts.ts')).not.toMatch(/review_state/);
    expect(read('lib/api/moderation.ts')).toMatch(/if \(error\) return new Map\(\);/);
    expect(read('supabase/functions/_shared/libraryActions.ts')).toMatch(/const startsInReview = async/);
  });
  it('off on self-host, and the Settings card only for admins on hosted multi-seat workspaces', () => {
    expect(read('hooks/useModeration.ts')).toMatch(/const enabled = !IS_SELF_HOSTED && !!workspace\?\.moderationNew;/);
    expect(read('pages/Settings.tsx')).toMatch(/!IS_SELF_HOSTED && isMultiSeat\(workspace\) && can\(currentUser, workspace, 'team:manage'\) && \(\s+<ModerationCard/);
  });
  it('MCP and Chat say it when something created starts in review — without an apostrophe', () => {
    const src = read('supabase/functions/_shared/libraryActions.ts');
    const note = src.match(/export const MODERATION_NOTE = '([^']*)';/);
    expect(note).not.toBeNull();
    expect(src).toMatch(/visibility:\s+inReview \? 'only-you-until-released'/);
  });
  it('texts in English and German', () => {
    for (const k of ['mod_title', 'mod_new_label', 'mod_save_submit', 'mod_banner_pending', 'mod_release', 'mod_reject']) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
    expect(de.mod_save_submit).toBe('Speichern und zur Prüfung einreichen');
  });
});

// ── SQEM-667 — changes to shared playbooks and personas ─────────────────────────────────────────────
const MIG667 = read('supabase/migrations/20261108230000_sqem667_moderate_changes.sql');
const ACTIONS = read('supabase/functions/_shared/libraryActions.ts');

describe('SQEM-667 — when a save becomes a proposal', () => {
  const base = { changesOn: true, moderator: false, released: true, shared: true, accessChanged: false };
  it('a shared, released object of a non-moderator with the switch on', () => {
    expect(changeNeedsReview(base)).toBe(true);
    expect(changeNeedsReview({ ...base, changesOn: false })).toBe(false);
    expect(changeNeedsReview({ ...base, moderator: true })).toBe(false);
    expect(changeNeedsReview({ ...base, released: false })).toBe(false); // a draft is the SQEM-666 path
  });
  it('"only me" is free — unless its access changes, which is always a change', () => {
    expect(changeNeedsReview({ ...base, shared: false })).toBe(false);
    expect(changeNeedsReview({ ...base, shared: false, accessChanged: true })).toBe(true);
  });
  it('only what differs goes into the proposal; access as the database keeps it', () => {
    expect(changedFields({ title: 'a', content: 'x', variables: [{ n: 1 }] }, { title: 'a', content: 'y', variables: [{ n: 1 }] })).toEqual({ content: 'y' });
    expect(accessRowsOf('everyone', ['u'], ['g'])).toEqual([]);
    expect(accessRowsOf('private', [], [])).toEqual([{}]);
    expect(accessRowsOf('restricted', ['u'], ['g'])).toEqual([{ user_id: 'u' }, { group_id: 'g' }]);
  });
});

describe('SQEM-667 — enforced where it is written', () => {
  it('the database locks content, access, routes and used files for clients; decide_change opens them', () => {
    expect(MIG667).toMatch(/create trigger guard_moderated_change before update on public\.prompts/);
    expect(MIG667).toMatch(/create trigger guard_moderated_change before update on public\.personas/);
    for (const t of ['template_access', 'persona_access', 'persona_templates', 'workspace_files']) {
      expect(MIG667, t).toMatch(new RegExp(`create trigger guard_moderated_relation before [a-z ]+ on public\\.${t}`));
    }
    const decide = MIG667.slice(MIG667.indexOf('function public.decide_change('));
    expect(decide.slice(0, decide.indexOf('$$;'))).toMatch(/perform set_config\('sqemes\.review', 'on', true\)[\s\S]*updated_by\s+= c\.author/);
  });
  it('⛔ the second switch only with the first, for every writer', () => {
    expect(MIG667).toMatch(/if not new\.moderation_new then\s+new\.moderation_changes := false;/);
  });
  it('MCP and Chat submit instead of writing, in every write path the service role takes', () => {
    for (const tool of ['update_template', 'update_persona', 'attach_template', 'detach_template', 'set_access']) {
      const body = ACTIONS.slice(ACTIONS.indexOf(`if (toolName === '${tool}')`));
      const end = body.indexOf("if (toolName === '", 10);
      expect(body.slice(0, end), tool).toMatch(/await goesToReview\(/);
    }
    const del = ACTIONS.slice(ACTIONS.indexOf(`if (toolName === 'delete_file')`));
    expect(del.slice(0, del.indexOf("if (toolName === '", 10))).toMatch(/only a moderator or an admin can replace or delete it/);
    const note = ACTIONS.match(/export const CHANGE_NOTE = '([^']*)';/);
    expect(note).not.toBeNull();
  });
  it('texts in English and German', () => {
    for (const k of ['mod_changes_label', 'chg_save_submit', 'chg_mine_pending', 'chg_conflict', 'chg_badge']) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
  });
});

// ── SQEM-669 — one review list ──────────────────────────────────────────────────────────────────────
describe('SQEM-669 — the review list', () => {
  const MIG669 = read('supabase/migrations/20261108240000_sqem669_review_queue.sql');
  it('both functions answer moderators and admins of that workspace only', () => {
    for (const fn of ['review_queue', 'pending_change_released_state']) {
      const body = MIG669.slice(MIG669.indexOf(`function public.${fn}(`));
      expect(body.slice(0, body.indexOf('$$;')), fn).toMatch(/is_workspace_moderator\(/);
    }
  });
  it('⛔ the released state is served only for a WAITING change', () => {
    expect(MIG669).toMatch(/where id = p_change_id and state = 'pending'/);
  });
  it('one entry, the same on Playbooks, Personas and the Overview, not on self-host — no block, no list filter', () => {
    for (const p of ['pages/Templates.tsx', 'pages/Personas.tsx']) {
      expect(read(p), p).toMatch(/!IS_SELF_HOSTED && workspace && currentUser && \(\s+<ModerationQueue /);
      expect(read(p), p).not.toMatch(/reviewOnly|searchParams\.get\('review'\)/);
    }
    expect(read('pages/Overview.tsx')).toMatch(/\{!IS_SELF_HOSTED && <ModerationQueue workspace=\{workspace\} user=\{currentUser\} \/>\}/);
    expect(read('pages/Overview.tsx')).not.toMatch(/overview-review/);
    expect(read('components/ModerationQueue.tsx')).toMatch(/if \(!moderation\.moderator \|\| !items \|\| items\.length === 0\) return null;/);
  });
  it('texts in English and German', () => {
    for (const k of ['mq_title', 'mq_compare', 'mq_no_access', 'mq_tab_changes']) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
  });
});
