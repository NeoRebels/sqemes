import { describe, it, expect } from 'vitest';
import { isStagingSupabaseUrl, STAGING_SUPABASE_PROJECT_REF } from '../../lib/environment';

describe('isStagingSupabaseUrl', () => {
  it('detects the staging Supabase project URL', () => {
    expect(isStagingSupabaseUrl(`https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`)).toBe(true);
  });

  it('does not match the production Supabase project URL', () => {
    expect(isStagingSupabaseUrl('https://uermxxoeqkfhzzpxhfyc.supabase.co')).toBe(false);
  });

  it('handles missing values', () => {
    expect(isStagingSupabaseUrl(undefined)).toBe(false);
    expect(isStagingSupabaseUrl('')).toBe(false);
  });
});
