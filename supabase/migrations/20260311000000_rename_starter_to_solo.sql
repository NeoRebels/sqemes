-- Rename plan tier: Starter -> Solo
-- Recreate the enum since PostgreSQL can't use a new enum value in the same transaction

-- 1. Drop the default first (it references the old enum)
ALTER TABLE public.workspaces ALTER COLUMN plan DROP DEFAULT;

-- 2. Rename old enum
ALTER TYPE plan_tier RENAME TO plan_tier_old;

-- 3. Create new enum with 'Solo' replacing 'Starter'
CREATE TYPE plan_tier AS ENUM ('Solo', 'Pro', 'Plus');

-- 4. Migrate the column, casting Starter -> Solo
ALTER TABLE public.workspaces
  ALTER COLUMN plan TYPE plan_tier
  USING (CASE plan::text WHEN 'Starter' THEN 'Solo'::plan_tier ELSE plan::text::plan_tier END);

-- 5. Set new default
ALTER TABLE public.workspaces ALTER COLUMN plan SET DEFAULT 'Solo';

-- 6. Drop old enum
DROP TYPE plan_tier_old;
