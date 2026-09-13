-- SQEM-390 — assistants become skills.
--
-- Two template kinds remain: a PROMPT (a task with variables) and a SKILL (knowledge, applied when
-- it fits). The role a team used to put into an assistant is what a PERSONA is for.
--
-- Why a data migration and not a soft deprecation: in the code an assistant and a skill were the
-- SAME mechanism. Both ended up as text in one system instruction (`composeSystemInstruction`), the
-- extension merely inserted a different column, and MCP served one field or the other. What kept
-- them apart were UI rules ("one assistant, any number of skills"), not a concept — and users kept
-- asking what an assistant was, now that personas exist. A kind nobody can explain is not kept for
-- the rows that carry it; the rows are moved.
--
-- What moves where:
--   prompts            kind 'assistant' → 'skill'. `content` ← `system_instruction` when that is
--                      non-empty. ⚠️ system_instruction alone, never the two concatenated: it WAS
--                      the assistant's canonical text (the app applied it, MCP served it, the
--                      extension inserted it), and a brand-voice assistant already carries its body
--                      compiled INTO it — concatenating would duplicate every one of those. `content`
--                      is kept only where system_instruction is empty (an MCP-created assistant
--                      without one).
--   library_templates  the same.
--   chat_sessions      `assistant_id` is PREPENDED to `applied_skill_ids` (the assistant IS that
--                      skill now, and the role came first in the composed instruction — prepending
--                      keeps the session's system prompt identical), then cleared.
--   constraints        both `kind` checks rewritten to ('prompt', 'skill').
--
-- ⚠️ KEPT, deliberately: `system_instruction` and `brand_config` on both tables, and
-- `chat_sessions.assistant_id`. Nothing reads them any more; they are the original text for anyone
-- who ever wants to reconstruct which skills used to be assistants. Nothing else marks that — the
-- counts below, in the migration output, are the only record of how many rows moved.
--
-- ⚠️ `updated_at` is NOT touched. The person did not edit these templates; the product did.

do $$
declare
  c          record;
  n_prompts  int;
  n_library  int;
  n_sessions int;
  n_left     int;
  def        text;
begin
  -- 1. The rows.
  update public.prompts
     set kind    = 'skill',
         content = case when coalesce(system_instruction, '') <> '' then system_instruction else content end
   where kind = 'assistant';
  get diagnostics n_prompts = row_count;

  update public.library_templates
     set kind    = 'skill',
         content = case when coalesce(system_instruction, '') <> '' then system_instruction else content end
   where kind = 'assistant';
  get diagnostics n_library = row_count;

  -- 2. Sessions that had an assistant applied keep it — as the first applied skill.
  update public.chat_sessions
     set applied_skill_ids = case
                               when assistant_id = any(applied_skill_ids) then applied_skill_ids
                               else array_prepend(assistant_id, applied_skill_ids)
                             end,
         assistant_id      = null
   where assistant_id is not null;
  get diagnostics n_sessions = row_count;

  -- 3. The constraints. Found by definition rather than by name: the one on `prompts` was created
  --    inline (`ADD COLUMN kind ... CHECK (...)`) and carries Postgres' generated name.
  for c in
    select conname, conrelid::regclass as rel
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.prompts'::regclass, 'public.library_templates'::regclass)
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table %s drop constraint %I', c.rel, c.conname);
  end loop;

  alter table public.prompts
    add constraint prompts_kind_check check (kind in ('prompt', 'skill'));
  alter table public.library_templates
    add constraint library_templates_kind_check check (kind in ('prompt', 'skill'));

  -- 4. Self-test — the pattern SQEM-335/351/352/371/389 established: prove the state the code will
  --    assume, rather than trusting that the statements ran.
  select count(*) into n_left from public.prompts where kind = 'assistant';
  if n_left > 0 then
    raise exception '[SQEM-390] % prompts still carry kind=assistant', n_left;
  end if;

  select count(*) into n_left from public.library_templates where kind = 'assistant';
  if n_left > 0 then
    raise exception '[SQEM-390] % library_templates still carry kind=assistant', n_left;
  end if;

  select count(*) into n_left from public.chat_sessions where assistant_id is not null;
  if n_left > 0 then
    raise exception '[SQEM-390] % chat_sessions still carry an assistant_id', n_left;
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conname = 'prompts_kind_check' and conrelid = 'public.prompts'::regclass;
  if def is null or def ilike '%assistant%' or def not ilike '%skill%' then
    raise exception '[SQEM-390] prompts_kind_check is %, expected (prompt, skill)', coalesce(def, 'missing');
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conname = 'library_templates_kind_check' and conrelid = 'public.library_templates'::regclass;
  if def is null or def ilike '%assistant%' or def not ilike '%skill%' then
    raise exception '[SQEM-390] library_templates_kind_check is %, expected (prompt, skill)', coalesce(def, 'missing');
  end if;

  raise notice '[SQEM-390] assistants → skills: % prompts, % library listings, % chat sessions', n_prompts, n_library, n_sessions;
end $$;
