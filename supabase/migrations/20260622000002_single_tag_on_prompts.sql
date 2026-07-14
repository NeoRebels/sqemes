-- Migrate prompts.tags (text[]) → prompts.tag (text, nullable)
-- Carry forward the first tag for any template that has one; discard the rest.
ALTER TABLE prompts ADD COLUMN tag text;
UPDATE prompts SET tag = tags[1] WHERE array_length(tags, 1) > 0;
ALTER TABLE prompts DROP COLUMN tags;
