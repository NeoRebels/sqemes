ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS brand_config jsonb DEFAULT NULL;
