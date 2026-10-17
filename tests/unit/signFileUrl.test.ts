import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  workspaceOfPath, clampExpiry, onPublicHost, dailyLimitMessage, MAX_PATHS_PER_CALL, MIN_EXPIRY, MAX_EXPIRY,
} from '../../supabase/functions/_shared/fileLinks';

/**
 * SQEM-515 — on Cloud the SERVER signs workspace-file links (`sign-file-url`), so every link can be
 * counted against the daily download ceiling. A link the browser signs cannot be counted.
 * Exported with the self-host build: there the browser keeps signing (its functions only see
 * `http://kong:8000`), which is why the self-host branch in lib/api/files.ts is pinned here too.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments (a `/*` inside a `//` line would swallow code).
const code = (s: string) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('fileLinks — the rules for a link', () => {
  it('the owning workspace is the first folder, and only a uuid counts', () => {
    expect(workspaceOfPath('aaaaaaaa-0000-4000-8000-0000000000aa/f/x.md')).toBe('aaaaaaaa-0000-4000-8000-0000000000aa');
    expect(workspaceOfPath('../etc/passwd')).toBeNull();
    expect(workspaceOfPath('')).toBeNull();
  });
  it('expiry is clamped; nonsense becomes the 5-minute default', () => {
    expect(clampExpiry(5)).toBe(MIN_EXPIRY);
    expect(clampExpiry(10 ** 9)).toBe(MAX_EXPIRY);
    expect(clampExpiry('x')).toBe(300);
    expect(clampExpiry(600)).toBe(600);
  });
  it('a link is moved to the public host without touching path or token', () => {
    const signed = 'https://abc.supabase.co/storage/v1/object/sign/workspace-files/w/f/x.md?token=T';
    expect(onPublicHost(signed, 'https://api.sqemes.com')).toBe('https://api.sqemes.com/storage/v1/object/sign/workspace-files/w/f/x.md?token=T');
    expect(onPublicHost(signed, null)).toBe(signed);
  });
  it('the limit message says what happened and when it resets', () => {
    expect(dailyLimitMessage(1048576 * 900, 1073741824)).toMatch(/900 MB of 1024 MB today.*00:00 UTC/);
  });
  it('a call carries a page, not the bucket', () => {
    expect(MAX_PATHS_PER_CALL).toBe(200);
  });
});

describe('sign-file-url — access first, then count, then sign', () => {
  const fn = code(read('supabase/functions/sign-file-url/index.ts'));
  it('⛔ reads the files with the CALLER\'s token, so RLS decides what may be signed', () => {
    expect(fn).toMatch(/asUser\.from\('workspace_files'\)/);
    expect(fn.indexOf("asUser.from('workspace_files')")).toBeLessThan(fn.indexOf('createSignedUrls('));
  });
  it('counts real sizes on the server before signing, and not on self-host', () => {
    expect(fn).toMatch(/if \(!SELF_HOSTED\)[\s\S]*record_file_download/);
    expect(fn.indexOf("rpc('record_file_download'")).toBeLessThan(fn.indexOf('createSignedUrls('));
  });
  it('signs a whole page in one call and answers 429 with the reason at the ceiling', () => {
    expect(fn).toMatch(/createSignedUrls\(allowed, expiresIn\)/);
    expect(fn).toMatch(/429/);
  });
  it('one workspace folder per call', () => {
    expect(fn).toMatch(/workspaces\.size !== 1/);
  });
});

describe('the browser no longer signs on Cloud', () => {
  it('lib/api/files.ts signs only on self-host and otherwise asks the server', () => {
    const src = code(read('lib/api/files.ts'));
    expect(src).toMatch(/if \(IS_SELF_HOSTED\) \{[\s\S]*createSignedUrl\(storagePath, expiresIn\)/);
    expect(src).toMatch(/functionCallUrl\('sign-file-url'\)/);
  });
  it('⛔ nothing else in the app calls createSignedUrl on workspace files', () => {
    const files = ['components', 'pages', 'lib', 'store', 'hooks'].flatMap(d => walk(resolve(ROOT, d)));
    const offenders = files
      .filter(f => !f.endsWith(join('lib', 'api', 'files.ts')))
      .filter(f => /createSignedUrls?\(/.test(code(readFileSync(f, 'utf8'))) && /workspace-files/.test(readFileSync(f, 'utf8')))
      .map(f => f.replace(ROOT + '/', ''));
    expect(offenders, 'sign workspace-file links through getWorkspaceFileSignedUrl()').toEqual([]);
  });
});
