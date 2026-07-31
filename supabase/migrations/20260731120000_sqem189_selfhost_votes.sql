-- SQEM-189 — let self-hosted instances vote on marketplace listings, feeding the SAME score as Cloud
-- votes (single source of truth). Cloud votes are keyed by `user_id` (a Cloud account); self-host votes
-- are keyed by an opaque `voter_key` = sha256(instance + self-host user id) — anonymous to the Cloud,
-- one vote per self-host user per listing. The existing `refresh_listing_votes` trigger sums ALL rows,
-- so score/vote_count already aggregate both sources unchanged.

-- 1. user_id becomes nullable (self-host rows have no Cloud user); add the opaque voter key.
alter table public.library_template_votes
  alter column user_id drop not null,
  add column if not exists voter_key text;

-- 2. Exactly one of user_id / voter_key must be set.
alter table public.library_template_votes
  drop constraint if exists library_template_votes_one_voter;
alter table public.library_template_votes
  add constraint library_template_votes_one_voter
  check (num_nonnulls(user_id, voter_key) = 1);

-- 3. Replace the (listing, user_id) unique with two partial uniques — one per voter kind — so a Cloud
--    user and a self-host voter_key each get one vote per listing.
alter table public.library_template_votes
  drop constraint if exists library_template_votes_library_template_id_user_id_key;

create unique index if not exists library_template_votes_user
  on public.library_template_votes (library_template_id, user_id)
  where user_id is not null;

create unique index if not exists library_template_votes_voterkey
  on public.library_template_votes (library_template_id, voter_key)
  where voter_key is not null;

-- RLS is unchanged: the own-rows policy (`user_id = auth.uid()`) still governs Cloud votes; voter_key
-- rows have a null user_id (never match auth.uid()), and are written only by the service role via the
-- public `marketplace-vote` edge function. The trigger stays as-is.
