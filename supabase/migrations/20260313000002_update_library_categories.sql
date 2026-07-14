-- ============================================================
-- Update library template categories
-- Sales → Business, add Data & Research
-- ============================================================

UPDATE public.library_templates
  SET category = 'Business'
  WHERE category = 'Sales';
