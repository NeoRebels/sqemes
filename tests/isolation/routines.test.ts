import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A, B } from './ownership';

/**
 * SQEM-675 — Routines, part 2: the schedule, what a person may write, the limit, leaving the workspace,
 * and the queue with its cap, retry and self-pause. Against the local database, like every isolation test.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const R = 'aaaaaaaa-0000-4000-8000-0000000675a1';      // a member of A who owns the test routines
const OTHER = 'aaaaaaaa-0000-4000-8000-0000000675a2';  // another member of A
const B_PERSONA = 'bbbbbbbb-0000-4000-8000-0000000675b1';
const A_ONLY_ME = 'aaaaaaaa-0000-4000-8000-00000000a002'; // a1's restricted playbook — R cannot see it
const A_OPEN = 'aaaaaaaa-0000-4000-8000-00000000a001';
const A_PERSONA = 'aaaaaaaa-0000-4000-8000-0000000675d1'; // an open persona of A
const OTHER_CONNECTOR = 'aaaaaaaa-0000-4000-8000-0000000675c1'; // OTHER's personal connector

const as = (uid: string, stmt: string) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, false)`);
const asCount = (uid: string, stmt: string) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, true)`);

const routine = (over: Record<string, string> = {}) => {
  const cols = { workspace_id: `'${A}'`, name: `'r'`, prompt: `'p'`, days: `'{1,2,3,4,5,6,7}'`, time_of_day: `'08:00'`, time_zone: `'Europe/Berlin'`, ...over };
  return `insert into public.routines (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`;
};
/** Insert as postgres (no client guard), owned by R. */
const seedRoutine = (id: string, over: Record<string, string> = {}, failures?: number) => {
  sql(`${routine({ id: `'${id}'`, user_id: `'${R}'`, ...over })}`);
  // An insert always starts at 0 failures; set the count afterwards, like the server would.
  if (failures !== undefined) sql(`update public.routines set failure_count = ${failures} where id = '${id}'`);
};
const rid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(675000000 + n).padStart(12, '0')}`;

function clean() {
  sql(`delete from public.routine_queue where user_id in ('${R}', '${OTHER}');
       delete from public.chat_sessions where user_id in ('${R}', '${OTHER}');
       delete from public.routines where user_id in ('${R}', '${OTHER}');
       insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${R}', 'member'), ('${A}', '${OTHER}', 'member')
         on conflict (workspace_id, user_id) do nothing;`);
}

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    from (values ('${R}', 'r675a@isolation.invalid'), ('${OTHER}', 'r675b@isolation.invalid')) as u(id, email)
    on conflict (id) do nothing;
    insert into public.personas (id, workspace_id, title, content, created_by) values ('${B_PERSONA}', '${B}', 'B persona', 'b', '${USERS.b1}'),
      ('${A_PERSONA}', '${A}', 'A open persona', 'a', '${USERS.a1}') on conflict do nothing;
    insert into public.workspace_connectors (id, workspace_id, created_by, user_id, name, mcp_url)
      values ('${OTHER_CONNECTOR}', '${A}', '${OTHER}', '${OTHER}', 'personal', 'https://example.invalid/mcp') on conflict do nothing;
  `);
  clean();
});
beforeEach(clean);
afterAll(() => {
  clean();
  sql(`delete from public.workspace_members where user_id in ('${R}', '${OTHER}');`);
});

describe('SQEM-675 — routine_next_run, in the person\'s time zone', () => {
  const next = (days: string, time: string, after: string) =>
    one(`select to_char(public.routine_next_run('${days}', '${time}', 'Europe/Berlin', '${after}'::timestamptz) at time zone 'UTC', 'YYYY-MM-DD HH24:MI')`);

  it('weekdays at 08:00: Friday after eight goes to Monday', () => {
    expect(next('{1,2,3,4,5}', '08:00', '2026-11-13 08:30+01')).toBe('2026-11-16 07:00');
  });
  it('the same day when the time is still ahead', () => {
    expect(next('{5}', '08:00', '2026-11-13 07:59+01')).toBe('2026-11-13 07:00');
  });
  it('08:00 stays 08:00 on the clock across spring forward', () => {
    expect(next('{1,2,3,4,5,6,7}', '08:00', '2026-03-28 08:30+01')).toBe('2026-03-29 06:00');
  });
  it('a time that does not exist (02:30 on 29 March) runs at the next valid moment, once', () => {
    expect(next('{7}', '02:30', '2026-03-28 12:00+01')).toBe('2026-03-29 01:30');
  });
  it('a time that exists twice (02:30 on 25 October) runs once', () => {
    const first = next('{7}', '02:30', '2026-10-24 12:00+02');
    expect(first.startsWith('2026-10-25')).toBe(true);
    expect(next('{7}', '02:30', `${first}+00`)).toBe('2026-11-01 01:30');
  });
});

describe('SQEM-675 — what a person may write', () => {
  it('creates their own routine; owner and next run are the server\'s', () => {
    expect(as(R, routine())).toBe('rows=1');
    expect(as(R, routine({ user_id: `'${OTHER}'` }))).toMatch(/^err=42501/); // no grant on user_id
    expect(as(R, routine({ next_run_at: `now()` }))).toMatch(/^err=42501/);
    expect(as(R, routine({ failure_count: '2' }))).toMatch(/^err=42501/);
  });
  it('may pause and resume, but not pause for failures or credits', () => {
    expect(as(R, routine({ paused_reason: `'user'` }))).toBe('rows=1');
    expect(as(R, routine({ paused_reason: `'failures'` }))).toMatch(/^err=42501/);
    seedRoutine(rid(1));
    expect(as(R, `update public.routines set paused_reason = 'credits' where id = '${rid(1)}'`)).toMatch(/^err=42501/);
    expect(as(R, `update public.routines set paused_reason = 'user' where id = '${rid(1)}'`)).toBe('rows=1');
  });
  it('a client update cannot move the next run or reset the failure count', () => {
    seedRoutine(rid(1), {}, 2);
    expect(as(R, `update public.routines set next_run_at = now() where id = '${rid(1)}'`)).toMatch(/^err=42501/);
    expect(as(R, `update public.routines set failure_count = 0 where id = '${rid(1)}'`)).toMatch(/^err=42501/);
  });
  it('rejects an unknown time zone and an invalid weekday', () => {
    expect(as(R, routine({ time_zone: `'Mars/Olympus'` }))).toMatch(/^err=22023/);
    expect(as(R, routine({ days: `'{0}'` }))).toMatch(/^err=23514/);
  });
  it('references stay in the workspace and within what the person may see', () => {
    expect(as(R, routine({ persona_id: `'${A_PERSONA}'`, playbook_ids: `'{${A_OPEN}}'` }))).toBe('rows=1');
    expect(as(R, routine({ persona_id: `'${B_PERSONA}'` }))).toMatch(/^err=23503/);
    expect(as(R, routine({ playbook_ids: `'{${A_ONLY_ME}}'` }))).toMatch(/^err=23503/);
    expect(as(R, routine({ connector_ids: `'{${OTHER_CONNECTOR}}'` }))).toMatch(/^err=23503/);
  });
  it('nobody else sees a routine — not a colleague, not the admin', () => {
    seedRoutine(rid(1));
    expect(asCount(OTHER, `select count(*) from public.routines where id = '${rid(1)}'`)).toBe('rows=0');
    expect(asCount(USERS.a1, `select count(*) from public.routines where id = '${rid(1)}'`)).toBe('rows=0');
    expect(asCount(R, `select count(*) from public.routines where id = '${rid(1)}'`)).toBe('rows=1');
    expect(as(USERS.a1, `delete from public.routines where id = '${rid(1)}'`)).toBe('rows=0');
  });
});

describe('SQEM-675 — at most 5 active routines per person', () => {
  it('the sixth active one is refused; paused ones do not count; resuming counts', () => {
    for (let i = 1; i <= 5; i++) seedRoutine(rid(i));
    seedRoutine(rid(6), { paused_reason: `'user'` });
    expect(as(R, routine())).toMatch(/^err=P0001.*at most 5/);
    expect(as(R, routine({ paused_reason: `'user'` }))).toBe('rows=1');
    expect(as(R, `update public.routines set paused_reason = null where id = '${rid(6)}'`)).toMatch(/^err=P0001/);
    expect(as(OTHER, routine())).toBe('rows=1');
  });
});

describe('SQEM-675 — leaving the workspace', () => {
  it('drops the person\'s routines, and only theirs', () => {
    seedRoutine(rid(1));
    sql(`${routine({ id: `'${rid(2)}'`, user_id: `'${OTHER}'` })}`);
    sql(`delete from public.workspace_members where workspace_id = '${A}' and user_id = '${R}'`);
    expect(one(`select count(*) from public.routines where id in ('${rid(1)}', '${rid(2)}')`)).toBe('1');
    expect(one(`select user_id from public.routines where id = '${rid(2)}'`)).toBe(OTHER);
  });
});

describe('SQEM-675 — chats of a routine', () => {
  const session = (uid: string, r: string) =>
    `insert into public.chat_sessions (workspace_id, user_id, title, routine_id) values ('${A}', '${uid}', 't', '${r}')`;
  it('a chat can only name a routine of its own person', () => {
    seedRoutine(rid(1));
    expect(as(R, session(R, rid(1)))).toBe('rows=1');
    expect(as(OTHER, session(OTHER, rid(1)))).toMatch(/^err=23503/);
  });
  it('the person marks it seen; the routine link is the server\'s', () => {
    seedRoutine(rid(1));
    sql(`insert into public.chat_sessions (id, workspace_id, user_id, title, routine_id, unseen) values ('${rid(90)}', '${A}', '${R}', 't', '${rid(1)}', true)`);
    expect(as(R, `update public.chat_sessions set unseen = false where id = '${rid(90)}'`)).toBe('rows=1');
    expect(as(R, `update public.chat_sessions set routine_id = null where id = '${rid(90)}'`)).toMatch(/^err=42501/);
  });
});

describe('SQEM-675 — the queue', () => {
  it('no client may call the queue functions or read the queue', () => {
    for (const f of [`complete_routine_run(1, true, null, 'x')`, `routine_dispatch_chat('{}'::jsonb)`, 'routines_tick()', 'enqueue_due_routines()', 'claim_routine_runs()', 'reap_routine_runs()', 'routine_run_heartbeat(1)', 'finish_routine_run(1, true)', `routine_record_failure('${rid(1)}')`]) {
      expect(as(R, `select public.${f}`), f).toMatch(/^err=42501/);
    }
    expect(asCount(R, `select count(*) from public.routine_queue`)).toMatch(/^err=42501/);
  });

  it('enqueues a due run once, skips one missed by more than 30 minutes, and moves both on', () => {
    seedRoutine(rid(1));
    seedRoutine(rid(2));
    sql(`update public.routines set next_run_at = now() - interval '5 minutes' where id = '${rid(1)}';
         update public.routines set next_run_at = now() - interval '2 hours' where id = '${rid(2)}';`);
    expect(one(`select public.enqueue_due_routines()`)).toBe('1');
    expect(one(`select count(*) from public.routine_queue where routine_id = '${rid(1)}'`)).toBe('1');
    expect(one(`select count(*) from public.routine_queue where routine_id = '${rid(2)}'`)).toBe('0');
    expect(one(`select count(*) from public.routines where id in ('${rid(1)}', '${rid(2)}') and next_run_at > now()`)).toBe('2');
    // The same local day again (e.g. the schedule was edited back): still one run. ⚠️ The SAME due time, not
    // "now() - 1 minute": shortly after local midnight that is already the next day — a second run, rightly —
    // and the suite failed when it happened to run just after midnight.
    sql(`update public.routines set next_run_at = (select due_at from public.routine_queue where routine_id = '${rid(1)}') where id = '${rid(1)}'`);
    expect(one(`select public.enqueue_due_routines()`)).toBe('0');
  });

  it('a paused routine is not enqueued', () => {
    seedRoutine(rid(1), { paused_reason: `'user'` });
    sql(`update public.routines set next_run_at = now() - interval '1 minute' where id = '${rid(1)}'`);
    expect(one(`select public.enqueue_due_routines()`)).toBe('0');
  });

  it('claims up to the cap, oldest first, never the same run twice', () => {
    for (let i = 1; i <= 3; i++) {
      seedRoutine(rid(i));
      sql(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day)
           values ('${rid(i)}', '${A}', '${R}', now() - interval '${10 - i} minutes', current_date)`);
    }
    const first = sql(`select routine_id from public.claim_routine_runs(2)`).map(r => r[0]);
    expect(first).toEqual([rid(1), rid(2)]);
    expect(sql(`select routine_id from public.claim_routine_runs(2)`)).toEqual([]);
    expect(sql(`select routine_id from public.claim_routine_runs(3)`).map(r => r[0])).toEqual([rid(3)]);
  });

  it('a silent run is retried once, then counts as a failure; three failures pause the routine', () => {
    seedRoutine(rid(1), {}, 2);
    sql(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day, state, lease_until)
         values ('${rid(1)}', '${A}', '${R}', now(), current_date, 'running', now() - interval '1 second')`);
    expect(sql(`select * from public.reap_routine_runs()`)).toEqual([['1', '0']]);
    expect(one(`select state || ' ' || attempt from public.routine_queue where routine_id = '${rid(1)}'`)).toBe('queued 2');
    sql(`update public.routine_queue set state = 'running', lease_until = now() - interval '1 second' where routine_id = '${rid(1)}'`);
    expect(sql(`select * from public.reap_routine_runs()`)).toEqual([['0', '1']]);
    expect(one(`select count(*) from public.routine_queue where routine_id = '${rid(1)}'`)).toBe('0');
    expect(one(`select failure_count || ' ' || paused_reason from public.routines where id = '${rid(1)}'`)).toBe('3 failures');
  });

  it('a heartbeat keeps a run; a finished run leaves no row and remembers its chat', () => {
    seedRoutine(rid(1), {}, 1);
    sql(`insert into public.chat_sessions (id, workspace_id, user_id, title, routine_id) values ('${rid(91)}', '${A}', '${R}', 't', '${rid(1)}')`);
    const q = one(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day, state, lease_until)
         values ('${rid(1)}', '${A}', '${R}', now(), current_date, 'running', now() + interval '5 seconds') returning id`);
    expect(one(`select public.routine_run_heartbeat(${q})`)).toBe('t');
    expect(one(`select lease_until > now() + interval '60 seconds' from public.routine_queue where id = ${q}`)).toBe('t');
    expect(one(`select public.finish_routine_run(${q}, true, '${rid(91)}')`)).toBe('t');
    expect(one(`select public.finish_routine_run(${q}, true, '${rid(91)}')`)).toBe('f'); // a late finisher owns nothing
    expect(one(`select count(*) from public.routine_queue where id = ${q}`)).toBe('0');
    expect(one(`select failure_count || ' ' || last_session_id from public.routines where id = '${rid(1)}'`)).toBe(`0 ${rid(91)}`);
  });

  it('a run silent twice writes the failure into its chat and links the routine to it', () => {
    seedRoutine(rid(1));
    sql(`insert into public.chat_sessions (id, workspace_id, user_id, title, routine_id, is_generating) values ('${rid(93)}', '${A}', '${R}', 't', '${rid(1)}', true)`);
    sql(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day, state, attempt, lease_until, session_id)
         values ('${rid(1)}', '${A}', '${R}', now(), current_date, 'running', 2, now() - interval '1 second', '${rid(93)}')`);
    expect(sql(`select * from public.reap_routine_runs()`)).toEqual([['0', '1']]);
    expect(one(`select content from public.chat_messages where session_id = '${rid(93)}' and role = 'assistant'`)).toMatch(/^This routine could not run: the run was interrupted on the server/);
    expect(one(`select unseen || ' ' || is_generating from public.chat_sessions where id = '${rid(93)}'`)).toBe('true false');
    expect(one(`select last_session_id from public.routines where id = '${rid(1)}'`)).toBe(rid(93));
  });

  it('complete_routine_run: queue row, answer, chat and routine in one go — only for the owner of the run', () => {
    seedRoutine(rid(1), {}, 2);
    sql(`insert into public.chat_sessions (id, workspace_id, user_id, title, routine_id, is_generating) values ('${rid(94)}', '${A}', '${R}', 't', '${rid(1)}', true)`);
    const q = one(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day, state) values ('${rid(1)}', '${A}', '${R}', now(), current_date, 'running') returning id`);
    expect(one(`select public.complete_routine_run(${q}, true, '${rid(94)}', 'the answer')`)).toBe('t');
    expect(one(`select public.complete_routine_run(${q}, true, '${rid(94)}', 'late answer')`)).toBe('f');
    expect(one(`select string_agg(content, '|') from public.chat_messages where session_id = '${rid(94)}' and role = 'assistant'`)).toBe('the answer');
    expect(one(`select unseen || ' ' || is_generating from public.chat_sessions where id = '${rid(94)}'`)).toBe('true false');
    expect(one(`select failure_count || ' ' || last_session_id from public.routines where id = '${rid(1)}'`)).toBe(`0 ${rid(94)}`);
  });

  it('complete_routine_run with credits: pauses the routine without counting a failure', () => {
    seedRoutine(rid(1));
    sql(`insert into public.chat_sessions (id, workspace_id, user_id, title, routine_id) values ('${rid(95)}', '${A}', '${R}', 't', '${rid(1)}')`);
    const q = one(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day, state) values ('${rid(1)}', '${A}', '${R}', now(), current_date, 'running') returning id`);
    expect(one(`select public.complete_routine_run(${q}, true, '${rid(95)}', 'no credits', p_pause => 'credits')`)).toBe('t');
    expect(one(`select failure_count || ' ' || paused_reason from public.routines where id = '${rid(1)}'`)).toBe('0 credits');
  });

  it('a failed run still points the routine at its chat (the failure is written there)', () => {
    seedRoutine(rid(1));
    sql(`insert into public.chat_sessions (id, workspace_id, user_id, title, routine_id) values ('${rid(92)}', '${A}', '${R}', 't', '${rid(1)}')`);
    const q = one(`insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day, state)
         values ('${rid(1)}', '${A}', '${R}', now(), current_date, 'running') returning id`);
    sql(`select public.finish_routine_run(${q}, false, '${rid(92)}')`);
    expect(one(`select failure_count || ' ' || last_session_id from public.routines where id = '${rid(1)}'`)).toBe(`1 ${rid(92)}`);
  });

  it('resuming after a self-pause starts the count afresh and schedules the next run', () => {
    seedRoutine(rid(1), { paused_reason: `'failures'` }, 3);
    expect(as(R, `update public.routines set paused_reason = null where id = '${rid(1)}'`)).toBe('rows=1');
    sql(`update public.routines set paused_reason = null where id = '${rid(1)}'`);
    expect(one(`select failure_count || ' ' || (next_run_at > now()) from public.routines where id = '${rid(1)}'`)).toBe('0 true');
  });
});
