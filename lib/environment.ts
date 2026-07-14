export const STAGING_SUPABASE_PROJECT_REF = 'lcwbwofdvitrisrwybmi';

export const isStagingSupabaseUrl = (url: string | undefined): boolean => {
  const value = url?.trim();
  if (!value) return false;

  try {
    return new URL(value).hostname === `${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
  } catch {
    return value.includes(STAGING_SUPABASE_PROJECT_REF);
  }
};

export const isStagingSupabaseEnvironment = isStagingSupabaseUrl(
  import.meta.env.VITE_SUPABASE_URL,
);
