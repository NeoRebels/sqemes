-- ============================================================
-- Migration: Library Templates
-- ============================================================

-- 1. Add sqemes admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_sqemes_admin boolean NOT NULL DEFAULT false;

-- 2. Create library_templates table (global, no workspace_id)
CREATE TABLE IF NOT EXISTS library_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'General',
  tags        text[] NOT NULL DEFAULT '{}',
  variables   jsonb NOT NULL DEFAULT '[]',
  steps       jsonb NOT NULL DEFAULT '[]',
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  usage_count integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. Add source_template_id to prompts
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES library_templates(id) ON DELETE SET NULL;

-- 4. Helper: is_sqemes_admin() — security definer so RLS can call it
CREATE OR REPLACE FUNCTION is_sqemes_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_sqemes_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- 5. Helper: increment_template_usage(template_id) — RPC
CREATE OR REPLACE FUNCTION increment_template_usage(template_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE library_templates
  SET usage_count = usage_count + 1
  WHERE id = template_id;
$$;

-- 6. Enable RLS
ALTER TABLE library_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: published templates visible to everyone, admins see all
CREATE POLICY "library_templates_select" ON library_templates
  FOR SELECT USING (published = true OR is_sqemes_admin());

-- INSERT: sqemes admins only
CREATE POLICY "library_templates_insert" ON library_templates
  FOR INSERT WITH CHECK (is_sqemes_admin());

-- UPDATE: sqemes admins only
CREATE POLICY "library_templates_update" ON library_templates
  FOR UPDATE USING (is_sqemes_admin());

-- DELETE: sqemes admins only
CREATE POLICY "library_templates_delete" ON library_templates
  FOR DELETE USING (is_sqemes_admin());
