-- SQEM-433 - a plan change must carry the AI-credit allowance with it.
--
-- The bug, in one sentence: `credits_limit` was written once, on INSERT, and never again. The only
-- trigger was `workspaces_apply_credit_limit AFTER INSERT`, and the Stripe webhook writes `plan` on
-- an upgrade but never touches `credits_limit` - so a workspace keeps the allowance of the tier it
-- was CREATED on, forever.
--
-- What that looked like from outside: a Business workspace showing "Seats 1 / 30" (correct - seats
-- come from the plan constant in the frontend) next to "AI credits 24 / 5,000" (the frozen column).
-- And it is not a display problem: `_shared/credits.ts` meters against this same column, so that
-- customer was really being cut off at 5% of what they pay for.
--
-- Why a BEFORE trigger and not an AFTER one like its INSERT sibling: an AFTER trigger has to UPDATE
-- the same row again, which fires itself. BEFORE writes `new.credits_limit` directly - no second
-- statement, no recursion to reason about. The WHEN clause keeps ordinary updates out entirely.
--
-- Why nothing changes in the Stripe webhook: the rule belongs to every path that changes a plan -
-- the webhook, manual SQL, a future admin screen. A second copy in the webhook is the one that
-- drifts.

-- ==========================================================================================
-- The one judgement call in this file: a limit that differs from the tier can be DELIBERATE.
-- SQEM-130 already made that distinction ("preserves unlimited (0), managed, and custom values"),
-- and a plan change must not silently delete a negotiated allowance.
--
-- So the rule is: only re-provision a value that looks like a DEFAULT. The defaults, including the
-- historical Solo allowance of 5000 that SQEM-130 replaced with 2000, are the only values treated as
-- "not chosen by anybody". 0 (unlimited) and managed workspaces are never touched, and a bespoke
-- number such as 60000 survives a plan change untouched.
-- ==========================================================================================
create or replace function public.is_default_credit_limit(v integer)
returns boolean
language sql immutable set search_path = ''
as $$
  -- 5000 is the pre-SQEM-130 Solo allowance. It has to stay in this list: the workspaces that most
  -- need repairing are exactly the old ones that still carry it.
  select v in (2000, 5000, 25000, 100000);
$$;

create or replace function public.apply_plan_credit_limit_on_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_managed then
    return new;
  end if;
  -- 0 means unlimited; a custom number means somebody decided it. Neither is ours to overwrite.
  if coalesce(new.credits_limit, 0) = 0 or not public.is_default_credit_limit(new.credits_limit) then
    return new;
  end if;
  new.credits_limit := public.plan_credit_limit(new.plan);
  return new;
end;
$$;

drop trigger if exists workspaces_credit_limit_follows_plan on public.workspaces;
create trigger workspaces_credit_limit_follows_plan
  before update of plan on public.workspaces
  for each row
  when (old.plan is distinct from new.plan)
  execute function public.apply_plan_credit_limit_on_change();

-- One-off repair of the workspaces that already drifted.
--
-- This changes billing-relevant numbers, so it reports how many rows it touched rather than doing it
-- silently. Read the count in the Supabase dashboard for the run - the deploy log only ever says
-- "Remote database is up to date" (the trap recorded for staging data migrations).
do $$
declare
  fixed integer;
begin
  update public.workspaces
    set credits_limit = public.plan_credit_limit(plan)
  where not is_managed
    and coalesce(credits_limit, 0) <> 0
    and public.is_default_credit_limit(credits_limit)
    and credits_limit <> public.plan_credit_limit(plan);
  get diagnostics fixed = row_count;
  raise notice 'SQEM-433: re-provisioned credits_limit on % workspace(s)', fixed;
end $$;

comment on function public.apply_plan_credit_limit_on_change() is 'SQEM-433 - carries the tier allowance onto credits_limit when a plan changes. Skips managed workspaces, unlimited (0) and any custom allowance, so a negotiated limit survives an upgrade.';
