-- Fix handle_new_user: the previous migration (20260217) incorrectly merged
-- workspace creation into this trigger and referenced `new.name`, which does
-- not exist on auth.users. This caused "Database error saving new user" on
-- every signup. Restore it to only create the profile; handle_new_profile
-- (on_profile_created trigger) continues to handle workspace creation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, avatar)
  VALUES (
    new.id,
    COALESCE(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'preferred_username',
      split_part(new.email, '@', 1)
    ),
    new.email,
    COALESCE(
      new.raw_user_meta_data ->> 'avatar_url',
      'https://api.dicebear.com/7.x/notionists/svg?seed=' || new.id::text
    )
  );
  RETURN new;
END;
$$;
