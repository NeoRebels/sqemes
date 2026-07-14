// JSR (Deno's registry) instead of esm.sh — esm.sh outages (522s) intermittently
// fail edge-function bundling at deploy time. JSR is Supabase's recommended source. (SQEM-058)
import { createClient } from 'jsr:@supabase/supabase-js@2';

export function createAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
