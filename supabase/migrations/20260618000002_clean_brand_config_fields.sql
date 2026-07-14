UPDATE public.prompts
SET brand_config = brand_config - 'dos' - 'donts' - 'formatRules'
WHERE brand_config IS NOT NULL
  AND (
    brand_config ? 'dos'
    OR brand_config ? 'donts'
    OR brand_config ? 'formatRules'
  );
