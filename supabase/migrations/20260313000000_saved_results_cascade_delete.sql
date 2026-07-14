-- ============================================================
-- Clean up orphaned saved_results and enforce cascade delete
-- ============================================================

-- 1. Delete orphaned records (folder was already deleted, result is inaccessible)
DELETE FROM public.saved_results WHERE folder_id IS NULL;

-- 2. Drop the existing SET NULL constraint and replace with CASCADE
ALTER TABLE public.saved_results
  DROP CONSTRAINT saved_results_folder_id_fkey,
  ADD CONSTRAINT saved_results_folder_id_fkey
    FOREIGN KEY (folder_id)
    REFERENCES public.folders(id)
    ON DELETE CASCADE;
