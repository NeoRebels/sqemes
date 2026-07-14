-- ensure pgcrypto is available for gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Add outbound notification URLs and signing secret to prompts
ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS outbound_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notification_secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex');
