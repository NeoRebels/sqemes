
import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { i18nOptions } from './i18n.config.mjs';

// Inline the app version (SQEM-118) so the self-host About/update notifier can read it.
// npm sets npm_package_version; fall back to reading package.json for non-npm invocations.
const appVersion =
  process.env.npm_package_version ||
  JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version;

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  // SQEM-599 — recompiles messages/*.json on change; the output is committed (see i18n.config.mjs).
  // Not under Vitest: the tests must read the COMMITTED output, not a copy regenerated for them.
  plugins: [react(), ...(process.env.VITEST ? [] : [paraglideVitePlugin(i18nOptions)])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) return 'vendor-react';
          if (id.includes('node_modules/@supabase/supabase-js')) return 'vendor-supabase';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules/react-markdown')) return 'vendor-markdown'; // SQEM-186 — react-quill-new was removed
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'pages/**', 'components/**'],
      exclude: ['**/*.spec.ts', 'node_modules/'],
    },
  },
});
