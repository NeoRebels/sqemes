import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeStorageFileName } from '../../lib/storageKey';

// SQEM-237 — the rule that keeps path separators and `..` out of a storage key, and the guard that
// keeps its two copies identical.
//
// The Deno edge functions and the browser bundle share no module system, so the function exists
// twice. The precedent in this repo (`lib/injectionScan.ts` ↔ `_shared/injectionScan.ts`) calls that
// "hand-synced" and leaves the syncing to whoever remembers. This pair does not: the last test below
// reads both files and fails if they stop agreeing.

describe('safeStorageFileName', () => {
  it('replaces forward slashes, so a path cannot nest the key', () => {
    expect(safeStorageFileName('scripts/run.py')).toBe('scripts_run.py');
  });

  it('replaces backslashes too — a Windows client is still a client', () => {
    expect(safeStorageFileName('scripts\\run.py')).toBe('scripts_run.py');
  });

  it('collapses .. so the key cannot climb', () => {
    // Order matters and the count is easy to get wrong. Slashes first:
    //   ../../etc/passwd  →  .._.._etc_passwd
    // then every run of dots, which leaves the underscores the slashes already put there:
    //   .._.._etc_passwd  →  ____etc_passwd     (four: dots, slash, dots, slash)
    expect(safeStorageFileName('../../etc/passwd')).toBe('____etc_passwd');
  });

  it('leaves a single dot alone — that is an extension, not a traversal', () => {
    expect(safeStorageFileName('notes.md')).toBe('notes.md');
  });

  it('leaves an ordinary name untouched', () => {
    expect(safeStorageFileName('Gesellschaftsvertrag 2026.pdf')).toBe('Gesellschaftsvertrag 2026.pdf');
  });

  it('is idempotent — running it twice changes nothing', () => {
    const once = safeStorageFileName('a/../b\\c.md');
    expect(safeStorageFileName(once)).toBe(once);
  });
});

describe('the two copies agree', () => {
  // The whole point of the duplication being acceptable. If this fails, someone edited one file and
  // not the other — fix the copy, do not relax the test.
  const bodyOf = (path: string): string => {
    const src = readFileSync(resolve(__dirname, '../..', path), 'utf8');
    const match = src.match(/export function safeStorageFileName\(fileName: string\): string \{([\s\S]*?)\n\}/);
    if (!match) throw new Error(`safeStorageFileName not found in ${path} — did its signature change?`);
    return match[1].replace(/\s+/g, ' ').trim();
  };

  it('lib/storageKey.ts and _shared/storageKey.ts hold the same implementation', () => {
    expect(bodyOf('lib/storageKey.ts')).toBe(bodyOf('supabase/functions/_shared/storageKey.ts'));
  });

  it('and the body is not empty, so a failed match cannot pass as agreement', () => {
    expect(bodyOf('lib/storageKey.ts').length).toBeGreaterThan(20);
  });
});
