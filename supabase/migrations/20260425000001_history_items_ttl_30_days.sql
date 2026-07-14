-- ============================================================
-- History Items TTL: extend retention from 7 days to 30 days
-- ============================================================

-- Update column default
ALTER TABLE public.history_items
  ALTER COLUMN expires_at SET DEFAULT now() + interval '30 days';

-- Extend existing records that haven't expired yet
UPDATE public.history_items
  SET expires_at = expires_at + interval '23 days'
  WHERE expires_at > now();
