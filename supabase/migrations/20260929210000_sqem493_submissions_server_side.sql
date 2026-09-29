-- SQEM-493 — Marketplace submissions are written by the server only.
--
-- Cloud submissions now go through the edge function `marketplace-submit-cloud`, which reads the
-- uploaded bundle and computes the injection scan and the content hash itself (the self-host path,
-- `marketplace-submit`, always did). The client insert that SQEM-163 allowed for workspace
-- admins/editors is therefore no longer needed, and it was the reason the review queue showed scan
-- values the browser had written. Only the Sqemes-admin editor (curated listings) still inserts from
-- the client; the column grants of SQEM-492 stay as they are for that path.

DROP POLICY IF EXISTS library_templates_insert ON public.library_templates;
CREATE POLICY library_templates_insert ON public.library_templates
  FOR INSERT
  WITH CHECK (public.is_sqemes_admin());
