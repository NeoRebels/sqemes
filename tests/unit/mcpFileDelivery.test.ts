import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deliveryOf, OCTET_STREAM } from '../../supabase/functions/_shared/skillFile';
import { relativeSkillPaths } from '../../supabase/functions/_shared/skillPaths';

/**
 * SQEM-514 (b) — MCP hands a file out by PURPOSE. A file to read comes back as text, a file to use
 * (scripts/, assets/, any binary) as a 15-minute download link, counted against the daily ceiling on
 * Cloud. `download_skill` gives a whole skill as its folder for agents that install skills.
 * mcp-server calls Deno.serve at load, so its wiring is pinned by reading the source.
 */
const ROOT = resolve(__dirname, '../..');
// Line comments first, then block comments (comment-stripper-order lesson).
const code = (s: string) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const MCP = code(readFileSync(resolve(ROOT, 'supabase/functions/mcp-server/index.ts'), 'utf8'));

describe('deliveryOf — read vs use', () => {
  it('text outside assets/ and scripts/ is read as text', () => {
    expect(deliveryOf('docx/references/ooxml.md', 'text/markdown')).toBe('text');
    expect(deliveryOf('docx/ooxml/schemas/wml.xsd', 'text/plain')).toBe('text');
  });
  it('scripts/, assets/ and every binary come back as a link', () => {
    expect(deliveryOf('docx/scripts/pack.py', 'text/x-python')).toBe('link');
    expect(deliveryOf('canvas/assets/template.html', 'text/html')).toBe('link');
    expect(deliveryOf('canvas/canvas-fonts/Inter.ttf', OCTET_STREAM)).toBe('link');
    expect(deliveryOf('diagram.png', 'image/png')).toBe('link');
    expect(deliveryOf('brief.pdf', 'application/pdf')).toBe('link');
  });
  it('as asks for the other; text cannot be made of a binary', () => {
    expect(deliveryOf('docx/scripts/pack.py', 'text/x-python', 'text')).toBe('text');
    expect(deliveryOf('notes.md', 'text/markdown', 'file')).toBe('link');
    expect(deliveryOf('Inter.ttf', OCTET_STREAM, 'text')).toBe('refuse');
    expect(deliveryOf('notes.md', 'text/markdown', 'nonsense')).toBe('text');
  });
});

describe('relativeSkillPaths — the folder as the skill knows it', () => {
  it('strips the skill folder only when every file carries it', () => {
    expect(relativeSkillPaths(['docx/SKILL-ref.md', 'docx/scripts/pack.py'], 'docx')).toEqual(['SKILL-ref.md', 'scripts/pack.py']);
    expect(relativeSkillPaths(['docx/a.md', 'references/b.md'], 'docx')).toEqual(['docx/a.md', 'references/b.md']);
    expect(relativeSkillPaths([], 'docx')).toEqual([]);
  });
  it('a path that would climb out of the folder becomes its bare name', () => {
    expect(relativeSkillPaths(['../../etc/passwd'], 'x')).toEqual(['passwd']);
  });
});

describe('mcp-server wiring', () => {
  it('read_context_file decides by deliveryOf, after the access check (contextFileMeta)', () => {
    const h = MCP.slice(MCP.indexOf("toolName === 'read_context_file'"), MCP.indexOf("toolName === 'download_skill'"));
    expect(h).toMatch(/const meta = await lib\.contextFileMeta\(fileId\)/);
    expect(h).toMatch(/deliveryOf\(meta\.name, meta\.mimeType, args\.as\)/);
    expect(h.indexOf('contextFileMeta(')).toBeLessThan(h.indexOf('issueDownloadLinks('));
  });

  it('links are downloads, 15 minutes, on the public host, and counted on Cloud only', () => {
    expect(MCP).toMatch(/const LINK_EXPIRY_SECONDS = 900;/);
    expect(MCP).toMatch(/createSignedUrls\(page, LINK_EXPIRY_SECONDS, \{ download: true \}\)/);
    expect(MCP).toMatch(/onPublicHost\(s\.signedUrl, publicBase\)/);
    expect(MCP).toMatch(/if \(!SELF_HOSTED\) \{\s*const \{ data: rec, error \} = await adminClient\.rpc\('record_file_download'/);
  });

  it('download_skill reads through the library (access rules), and get_template still carries no links', () => {
    const h = MCP.slice(MCP.indexOf("toolName === 'download_skill'"), MCP.indexOf("toolName === 'list_files'"));
    expect(h).toMatch(/await lib\.skillFolder\(/);
    expect(h).toMatch(/buildSkillMd\(/);
    const getTpl = MCP.slice(MCP.indexOf("toolName === 'get_template'"), MCP.indexOf("toolName === 'read_context_file'"));
    expect(getTpl).not.toMatch(/issueDownloadLinks|createSignedUrl/);
  });

  it('self-host gives the functions their public address, so a link is reachable from outside', () => {
    const compose = readFileSync(resolve(ROOT, 'selfhost/docker-compose.sqemes.yml'), 'utf8');
    const functions = compose.slice(compose.indexOf('\n  functions:'), compose.indexOf('\n  storage:'));
    expect(functions).toMatch(/PUBLIC_API_URL: \$\{SUPABASE_PUBLIC_URL\}/);
    expect(functions).toMatch(/SELF_HOSTED: "true"/);
  });
});
