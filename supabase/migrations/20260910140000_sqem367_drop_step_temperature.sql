-- SQEM-367 — remove `temperature` from every legacy `steps` entry, in both tables that hold them.
--
-- ⛔ Written as an ADDITIVE migration instead of editing `20260313000003_seed_library_templates.sql`,
-- which is where ~90 of these values were written. That file has been on production since March, and
-- `AGENTS.md` in the source repository allows editing a migration only once it has NOT reached
-- production. Editing it would in any case have fixed nothing already in a database — only changed
-- what a fresh install seeds, while leaving every existing row untouched and the history describing
-- something that never ran.
--
-- ⭐ This does both: it clears the rows that exist, and a fresh install seeds then immediately clears
-- them, so the end state is identical without falsifying anything.
--
-- ⚠️ The values were inert already — `steps` is legacy-read-only (multi-step chains were removed in
-- SQEM-040) and nothing executes them. They are removed because a stored number nobody set and
-- nothing reads is a claim the product does not make: it invites the next person to wire it back up.

do $$
declare
  touched_prompts int;
  touched_library int;
  leftovers int;
begin
  -- Strip the key from each array element. The `exists` guard keeps this to rows that carry one,
  -- so re-running it is free and no row is rewritten for nothing.
  update public.prompts
     set steps = (
       select coalesce(jsonb_agg(elem - 'temperature'), '[]'::jsonb)
         from jsonb_array_elements(steps) elem
     )
   where jsonb_typeof(steps) = 'array'
     and exists (select 1 from jsonb_array_elements(steps) e where e ? 'temperature');
  get diagnostics touched_prompts = row_count;

  update public.library_templates
     set steps = (
       select coalesce(jsonb_agg(elem - 'temperature'), '[]'::jsonb)
         from jsonb_array_elements(steps) elem
     )
   where jsonb_typeof(steps) = 'array'
     and exists (select 1 from jsonb_array_elements(steps) e where e ? 'temperature');
  get diagnostics touched_library = row_count;

  raise notice '[SQEM-367] cleared temperature from % prompts row(s) and % library_templates row(s)',
    touched_prompts, touched_library;

  -- Self-test, the pattern SQEM-335/351/352 established: prove the statement did what it claims
  -- rather than trusting that it ran. A leftover here fails the deploy instead of passing quietly.
  select count(*) into leftovers from (
    select 1 from public.prompts
      where jsonb_typeof(steps) = 'array'
        and exists (select 1 from jsonb_array_elements(steps) e where e ? 'temperature')
    union all
    select 1 from public.library_templates
      where jsonb_typeof(steps) = 'array'
        and exists (select 1 from jsonb_array_elements(steps) e where e ? 'temperature')
  ) remaining;

  if leftovers > 0 then
    raise exception '[SQEM-367] % row(s) still carry a step temperature after the cleanup', leftovers;
  end if;
end $$;
