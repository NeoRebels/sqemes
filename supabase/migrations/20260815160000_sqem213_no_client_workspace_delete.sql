-- SQEM-213 — take the workspace delete away from the client.
--
-- `workspaces_delete` let any admin delete the row straight from the browser, and that is exactly
-- how the subscription came to be left running: the row disappeared and Stripe never heard about
-- it. Deletion now goes through the `delete-workspace` edge function, which cancels first and
-- deletes only if that succeeded.
--
-- Dropping the policy is what makes that route the *only* route. Without it the edge function is a
-- suggestion — anyone with an admin token could still issue the raw DELETE and skip the
-- cancellation, which is precisely the bug.
--
-- The service role is unaffected (it bypasses RLS), so the edge function and the
-- `cleanup-abandoned-workspaces` cron keep working. No other client code deletes workspaces;
-- `lib/api/workspaces.ts` is switched to the function in the same change.

drop policy if exists "workspaces_delete" on public.workspaces;
