import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * SQEM-456 — one place turns `VITE_SUPABASE_URL` into an edge-function URL.
 *
 * ⛔ **This test is the point of the ticket, not a formality.** Production's `VITE_SUPABASE_URL` ends
 * in a slash, and **nineteen** call sites appended `/functions/v1/…` straight onto it — so the MCP
 * configuration people copy into Claude Desktop read `https://api.sqemes.com//functions/v1/mcp-server`.
 * Nothing was broken (both forms answer 401; Supabase routes the double slash away), but a config
 * string that looks wrong is one people stop trusting.
 *
 * ⭐ The rule already existed **twice** — in `lib/api/connectors.ts` since SQEM-439, and inside
 * `marketplaceUrlFor` — and was unreachable both times. Nobody imports a URL rule from an API module.
 * So the rule moved to `lib/env.ts`, and this guard stops the twentieth call site from being written.
 */
const ROOT = resolve(__dirname, '../../');
const SEARCHED = ['components', 'pages', 'lib', 'store', 'hooks'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = [...SEARCHED.flatMap(d => walk(resolve(ROOT, d))), resolve(ROOT, 'App.tsx')];

describe('SQEM-456 — the function base is normalised in one place', () => {
  it('⛔ nothing appends a path to VITE_SUPABASE_URL', () => {
    // ⚠️ READING the variable is fine — `lib/supabase.ts` and `lib/environment.ts` legitimately do.
    // What is banned is concatenating a path onto it, because that is where the slash doubles.
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/VITE_SUPABASE_URL\s*\}?\s*[}`]?\s*\//.test(src) || /VITE_SUPABASE_URL\}\//.test(src)) {
        offenders.push(f.slice(ROOT.length + 1));
      }
    }
    expect(offenders, 'use functionsUrl() / FUNCTIONS_BASE from lib/env.ts instead').toEqual([]);
  });

  it('the normalisation itself strips every trailing slash', () => {
    const env = readFileSync(resolve(ROOT, 'lib/env.ts'), 'utf8');
    // `/\/+$/` and not `/\/$/`: a value ending in `//` would otherwise still leave one behind, and
    // an environment variable is typed by a person.
    expect(env).toMatch(/export const SUPABASE_BASE = String\(import\.meta\.env\.VITE_SUPABASE_URL \?\? ''\)\.trim\(\)\.replace\(\/\\\/\+\$\/, ''\)/);
    expect(env).toMatch(/export function functionsUrl\(name: string\): string/);
    expect(env).toMatch(/export const FUNCTIONS_BASE/);
  });

  it('⚠️ the two surfaces a person actually copies use it', () => {
    // These are the only two that are DISPLAYED — the MCP configuration in Settings and in the setup
    // wizard. Everything else merely calls the URL, where the double slash was invisible.
    expect(readFileSync(resolve(ROOT, 'pages/Settings.tsx'), 'utf8')).toMatch(/functionsUrl\('mcp-server'\)/);
    expect(readFileSync(resolve(ROOT, 'components/SetupWizard.tsx'), 'utf8')).toMatch(/functionsUrl\('mcp-server'\)/);
  });
});
