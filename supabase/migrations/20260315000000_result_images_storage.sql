-- Track images uploaded to the result-images Storage bucket.
-- Enables 30-day TTL cleanup via the cleanup-result-images edge function.

-- Add image_expires_at to saved_results so the UI can display an expiry notice.
ALTER TABLE public.saved_results
  ADD COLUMN IF NOT EXISTS image_expires_at timestamptz;

-- Tracking table. ON DELETE SET NULL so rows survive result deletion;
-- the cleanup cron removes rows where saved_result_id IS NULL OR expires_at < now().
CREATE TABLE IF NOT EXISTS public.result_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  saved_result_id uuid REFERENCES public.saved_results(id) ON DELETE SET NULL,
  storage_path    text NOT NULL,   -- '{workspace_id}/{result_id}/step{n}_{ts}.ext'
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS result_images_saved_result_idx ON public.result_images(saved_result_id);
CREATE INDEX IF NOT EXISTS result_images_expires_at_idx   ON public.result_images(expires_at);

ALTER TABLE public.result_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_result_images"
  ON public.result_images FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "workspace_members_insert_result_images"
  ON public.result_images FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- Create the result-images Storage bucket (public, 10 MB per file).
-- If the bucket already exists this is a no-op.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('result-images', 'result-images', true, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read objects in the public bucket (explicit policy).
CREATE POLICY "result_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'result-images');

-- ============================================================
-- Run the following SQL in Supabase SQL Editor to register
-- the daily cleanup cron job (requires pg_cron + pg_net):
--
-- SELECT cron.schedule(
--   'cleanup-result-images-daily',
--   '0 3 * * *',
--   $$
--   SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/cleanup-result-images',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--     ),
--     body := '{}'::jsonb
--   )
--   $$
-- );
-- ============================================================
