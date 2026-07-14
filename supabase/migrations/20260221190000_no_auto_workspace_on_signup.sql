-- Remove auto-workspace creation for non-invited fresh signups.
-- Previously handle_new_profile auto-created "[name]'s Workspace" when there
-- were no pending invitations, bypassing the Create Workspace screen entirely.
-- Now the trigger only accepts pending invitations; if there are none it does
-- nothing, so init() finds zero workspaces and shows the Create Workspace screen.

CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv record;
  inv_count integer;
BEGIN
  SELECT count(*) INTO inv_count
  FROM public.invitations
  WHERE email = new.email AND status = 'pending';

  IF inv_count > 0 THEN
    -- Accept all valid pending invitations
    FOR inv IN
      SELECT id, workspace_id, role
      FROM public.invitations
      WHERE email = new.email
        AND status = 'pending'
        AND expires_at > now()
    LOOP
      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (inv.workspace_id, new.id, inv.role)
      ON CONFLICT (workspace_id, user_id) DO NOTHING;

      UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;
    END LOOP;

    -- Expire any invitations that are past their expiry
    UPDATE public.invitations
    SET status = 'expired'
    WHERE email = new.email AND status = 'pending' AND expires_at <= now();
  END IF;

  -- No invitations: do nothing. init() will find zero workspaces and
  -- show the Create Workspace screen.
  RETURN new;
END;
$$;
