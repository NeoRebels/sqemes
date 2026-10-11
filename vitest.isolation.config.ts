import { defineConfig } from 'vitest/config';

// SQEM-504 — the tenant-isolation suite needs the LOCAL Supabase stack (`npx supabase start`), so it is
// kept out of `npm test` (tests/unit only) and runs on its own: `npm run test:isolation`.
export default defineConfig({
  test: {
    include: ['tests/isolation/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
