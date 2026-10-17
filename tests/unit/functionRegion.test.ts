import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FUNCTION_REGION, functionCallUrl, functionsUrl } from '../../lib/env';
import { HOME_REGION } from '../../supabase/functions/_shared/regionForward';

/**
 * SQEM-513 — the app calls its edge functions next to the database (`eu-west-1`), and nothing that is
 * SHOWN or handed to a third party carries the region parameter.
 *
 * Supabase runs a function where the caller is; a browser in Germany landed in Frankfurt while the
 * database is in Ireland (roughly twice the latency). `functionCallUrl()`
 * pins the region for `fetch`; `functionsUrl()` stays parameter-free for the MCP URL customers paste
 * into Claude/ChatGPT (a query string there breaks the OAuth metadata, SQEM-449/510) and for the OAuth
 * `redirect_uri` that providers allowlist verbatim.
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
// Line comments FIRST, then block comments: a `/*` inside a `//` line would otherwise swallow code.
// `(^|[^:])` keeps `https://…` inside strings intact.
const code = (f: string) => readFileSync(f, 'utf8')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const FILES = [...SEARCHED.flatMap(d => walk(resolve(ROOT, d))), resolve(ROOT, 'App.tsx')];

describe('SQEM-513 — the app calls its functions in the database region', () => {
  it('the app and the server agree on the region', () => {
    expect(FUNCTION_REGION).toBe(HOME_REGION);
    expect(HOME_REGION).toBe('eu-west-1');
  });

  it('a call URL pins the region; a shown URL does not', () => {
    expect(functionCallUrl('chat-message')).toBe(`${functionsUrl('chat-message')}?forceFunctionRegion=eu-west-1`);
    expect(functionsUrl('mcp-server')).not.toContain('?');
  });

  it('⛔ every fetch of an edge function goes through functionCallUrl()', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(f);
      if (/fetch\(\s*functionsUrl\(/.test(src) || /fetch\(\s*`\$\{FUNCTIONS_(BASE|URL)\}/.test(src)) {
        offenders.push(f.replace(ROOT + '/', ''));
      }
    }
    expect(offenders, 'call edge functions with functionCallUrl() from lib/env.ts').toEqual([]);
  });

  it('⛔ the MCP URL customers paste and the OAuth redirect_uri stay parameter-free', () => {
    for (const f of ['pages/Settings.tsx', 'components/SetupWizard.tsx']) {
      const src = code(resolve(ROOT, f));
      expect(src).toMatch(/functionsUrl\('mcp-server'\)/);
      expect(src).not.toMatch(/functionCallUrl\('mcp-server'\)/);
    }
    const connectors = code(resolve(ROOT, 'lib/api/connectors.ts'));
    expect(connectors).toMatch(/return `\$\{FUNCTIONS_URL\}\/connector-oauth-callback`;/);
  });
});
