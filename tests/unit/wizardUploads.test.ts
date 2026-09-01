import { describe, it, expect } from 'vitest';
import { isReadableAsText } from '../../lib/wizardUploads';

describe('isReadableAsText', () => {
  it('accepts text MIME types', () => {
    expect(isReadableAsText({ name: 'notes.txt', type: 'text/plain' })).toBe(true);
    expect(isReadableAsText({ name: 'data.csv', type: 'text/csv' })).toBe(true);
  });

  // ⚠️ The case that decides whether this feature is usable at all: browsers take the MIME type
  // from the OS registry, which knows about Word and not about Markdown. Judging on MIME alone
  // would reject exactly the documents somebody wants analysed.
  it('accepts known text extensions when the browser reports nothing useful', () => {
    expect(isReadableAsText({ name: 'handbook.md', type: '' })).toBe(true);
    expect(isReadableAsText({ name: 'script.py', type: 'application/octet-stream' })).toBe(true);
  });

  // Not text — which since SQEM-316 no longer means "not readable": a PDF goes to the model as a
  // document part instead. This predicate answers only "can it be read as text".
  it('does not claim binaries are text', () => {
    expect(isReadableAsText({ name: 'manual.pdf', type: 'application/pdf' })).toBe(false);
    expect(isReadableAsText({ name: 'logo.png', type: 'image/png' })).toBe(false);
    expect(isReadableAsText({ name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(false);
  });

  it('refuses a file with no extension and no usable type', () => {
    expect(isReadableAsText({ name: 'Makefile', type: '' })).toBe(false);
  });
});

import { resolveVisibleFiles } from '../../lib/wizardUploads';

const visible = [
  { id: 'a', name: 'brand-voice.md' },
  { id: 'b', name: 'pricing-2026.csv' },
];

describe('resolveVisibleFiles', () => {
  it('resolves names the workspace actually has', () => {
    expect(resolveVisibleFiles(['brand-voice.md'], visible).map(f => f.id)).toEqual(['a']);
  });

  // ⛔ The property that matters. A name the model invented — or repeated from a document belonging
  // to another team — must be discarded, never looked up. This is a filter over what RLS already
  // released, not a query.
  it('discards a name the workspace does not have', () => {
    expect(resolveVisibleFiles(['secret-salaries.csv', 'brand-voice.md'], visible).map(f => f.id)).toEqual(['a']);
  });

  it('returns nothing for an empty list', () => {
    expect(resolveVisibleFiles([], visible)).toEqual([]);
  });

  // Names are not unique in workspace_files (SQEM-251) — all matches come back rather than an
  // arbitrary one, because attaching a file nobody chose is worse than attaching two.
  it('returns every match when a name is duplicated', () => {
    const dupes = [...visible, { id: 'c', name: 'brand-voice.md' }];
    expect(resolveVisibleFiles(['brand-voice.md'], dupes).map(f => f.id)).toEqual(['a', 'c']);
  });
});

import { classifyUpload, MAX_BINARY_BYTES } from '../../lib/wizardUploads';

const pdf = { name: 'recap.pdf', type: 'application/pdf', size: 1024 };

describe('classifyUpload', () => {
  it('reads text regardless of provider', () => {
    expect(classifyUpload({ name: 'notes.md', type: '', size: 10 }, 'deepseek')).toEqual({ ok: true, binary: false });
  });

  // ⛔ The correction SQEM-316 is really about. Mistral and OpenRouter were refused for six months
  // on an assumption written in February 2026 and never dated — both take a PDF today.
  it('allows a PDF on every provider that can take a document', () => {
    for (const p of ['gemini', 'openai', 'claude', 'mistral', 'openrouter', 'sqemes']) {
      expect(classifyUpload(pdf, p), p).toEqual({ ok: true, binary: true });
    }
  });

  // ⚠️ Still correct, and checked so that widening the list does not quietly widen it too far:
  // xAI takes images only, DeepSeek's Chat Completions schema has no file part at all.
  it('refuses a PDF where the provider has no document part — with a reason', () => {
    for (const p of ['grok', 'deepseek']) {
      const v = classifyUpload(pdf, p);
      expect(v.ok, p).toBe(false);
      if (v.ok === false) expect(v.reason).toContain('AI for authoring');
    }
  });

  it('allows images everywhere — they survive every provider branch', () => {
    expect(classifyUpload({ name: 'slide.png', type: 'image/png', size: 2048 }, 'deepseek')).toEqual({ ok: true, binary: true });
  });

  // The limit is enforced at pick time, not by the server: base64 inflates ~33% and waiting a
  // minute for the generation to fail is the expensive way to learn the file was too big.
  it('refuses a file too large for the request body', () => {
    const v = classifyUpload({ ...pdf, size: MAX_BINARY_BYTES + 1 }, 'gemini');
    expect(v.ok).toBe(false);
  });

  it('refuses a format that is neither text, PDF nor image', () => {
    expect(classifyUpload({ name: 'archive.zip', type: 'application/zip', size: 10 }, 'gemini').ok).toBe(false);
  });
});

import { generatedFileName } from '../../lib/wizardUploads';

describe('generatedFileName', () => {
  it('forces .md — the content is markdown by construction', () => {
    expect(generatedFileName('tone-of-voice.txt', [])).toBe('tone-of-voice.md');
    expect(generatedFileName('tone-of-voice', [])).toBe('tone-of-voice.md');
    expect(generatedFileName('tone-of-voice.md', [])).toBe('tone-of-voice.md');
  });

  // ⛔ A path segment would be read as a folder by `folderOf` and would claim a structure nobody
  // asked for — the confusion SQEM-251 had to untangle when two skills merged their references/.
  it('strips path segments the model may have invented', () => {
    expect(generatedFileName('references/tone.md', [])).toBe('tone.md');
    expect(generatedFileName('../../etc/passwd', [])).toBe('passwd.md');
  });

  // ⚠️ The database will not stop this: workspace_files has no unique constraint on
  // (workspace_id, name). Two runs would leave two identical names, told apart only by
  // context_file_ids — which the Files page does not show. Two files with one name is worse
  // than an ugly name.
  it('avoids a collision rather than letting the library hold two of one name', () => {
    expect(generatedFileName('brand-voice.md', ['brand-voice.md'])).toBe('brand-voice (2).md');
    expect(generatedFileName('brand-voice.md', ['brand-voice.md', 'brand-voice (2).md'])).toBe('brand-voice (3).md');
  });

  it('matches an existing name case-insensitively', () => {
    expect(generatedFileName('Brand-Voice.md', ['brand-voice.md'])).toBe('Brand-Voice (2).md');
  });

  it('falls back to a usable name when the model returns nothing usable', () => {
    expect(generatedFileName('', [])).toBe('context.md');
    expect(generatedFileName('   ', [])).toBe('context.md');
    expect(generatedFileName('...', [])).toBe('context.md');
  });
});
