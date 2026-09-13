import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-402 — Vercel Speed Insights is a Cloud thing; on self-host it was a SyntaxError per page.
 *
 * `<SpeedInsights />` injects `/_vercel/speed-insights/script.js`. nginx in the self-host image
 * answers a path it does not know with the SPA fallback page, so the browser parsed HTML as
 * JavaScript on every page load of every bundle up to v1.11.14. Nobody saw it because nobody ran a
 * built image until SQEM-323's check did. The mount is gated on `!IS_SELF_HOSTED`; this pins it.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-402 — Speed Insights mounts on Cloud only', () => {
  const app = code(read('App.tsx'));

  it('the only mount of <SpeedInsights /> sits behind !IS_SELF_HOSTED', () => {
    const mounts = app.match(/<SpeedInsights \/>/g) ?? [];
    expect(mounts.length).toBe(1);
    expect(app).toMatch(/\{!IS_SELF_HOSTED && <SpeedInsights \/>\}/);
  });

  it('IS_SELF_HOSTED comes from lib/env, the one place the flag is read', () => {
    expect(app).toMatch(/import \{ IS_SELF_HOSTED \} from '\.\/lib\/env'/);
  });
});
