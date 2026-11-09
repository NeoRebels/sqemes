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
const MCP = code((readFileSync(resolve(ROOT, 'supabase/functions/mcp-server/index.ts'), 'utf8') + '\n' + readFileSync(resolve(ROOT, 'supabase/functions/_shared/libraryActions.ts'), 'utf8') + '\n' + readFileSync(resolve(ROOT, 'supabase/functions/_shared/libraryToolDefs.ts'), 'utf8')));

describe('deliveryOf — one rule since SQEM-658: readable → text, wherever it sits', () => {
  it('text is read as text, in references/ as in scripts/ and assets/ (no folder rule any more)', () => {
    expect(deliveryOf('docx/references/ooxml.md', 'text/markdown')).toBe('text');
    expect(deliveryOf('docx/ooxml/schemas/wml.xsd', 'text/plain')).toBe('text');
    expect(deliveryOf('docx/scripts/pack.py', 'text/x-python')).toBe('text');
    expect(deliveryOf('canvas/assets/template.html', 'text/html')).toBe('text');
  });
  it('what cannot be read comes back as a link', () => {
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

  // SQEM-522 — the rule, not one line: SQEM-514 pinned only the download line above, and the older
  // upload link (SQEM-059) kept handing out the raw storage host until a PPTX upload failed in a
  // sandbox that allowed only the public API host.
  it('⛔ every signed URL the server hands an agent is on the public host — downloads AND uploads', () => {
    const uses = [...MCP.matchAll(/[A-Za-z_.]*\bsignedUrl\b/g)].map(m => MCP.slice(Math.max(0, m.index! - 40), m.index! + 20));
    const handedOut = uses.filter(u => !/s\.signedUrl &&|&& s\.signedUrl/.test(u)); // the existence check in the loop
    expect(handedOut.length).toBeGreaterThanOrEqual(2);
    for (const u of handedOut) expect(u, u).toMatch(/onPublicHost\(/);
    const upload = MCP.slice(MCP.indexOf("toolName === 'create_upload_url'"), MCP.indexOf("toolName === 'finalize_upload'"));
    // SQEM-622 — computed once (it also feeds the sandbox hint), then handed out as `uploadUrl`.
    expect(upload).toMatch(/const uploadUrl\s*=\s*onPublicHost\(signed\.signedUrl, Deno\.env\.get\('PUBLIC_API_URL'\) \?\? null\)/);
    expect(upload).toMatch(/^\s+uploadUrl,$/m);
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

describe('SQEM-658 — Office files follow the read-vs-use rule', () => {
  it('as text wherever they sit; the original on request', () => {
    expect(deliveryOf('angebot/references/Preise.xlsx', OCTET_STREAM)).toBe('text');
    expect(deliveryOf('Pitch.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('text');
    expect(deliveryOf('brief/assets/Briefkopf.docx', OCTET_STREAM)).toBe('text');
    expect(deliveryOf('brief/assets/Briefkopf.docx', OCTET_STREAM, 'file')).toBe('link');
    expect(deliveryOf('references/Preise.xlsx', OCTET_STREAM, 'file')).toBe('link');
    expect(deliveryOf('alt.doc', OCTET_STREAM, 'text')).toBe('refuse');
  });
  it('the tool description says so', () => {
    const defs = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/libraryToolDefs.ts'), 'utf8');
    expect(defs).toMatch(/Every file sqemes can read comes back as text, wherever it sits in the skill/);
    expect(defs).toMatch(/Pass as: "file" for the original of any file/);
  });
  it('⛔ both edge functions pass the unzip in; only they import npm:jszip for it', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
    expect(src('supabase/functions/mcp-server/index.ts')).toMatch(/createLibraryReader\(\{[^}]*unzip: unzipEntries, unzipPictures: unzipWithPictures \}\)/);
    expect(src('supabase/functions/chat-message/index.ts')).toMatch(/createLibraryReader\(\{[^}]*unzip: unzipEntries \}\)/);
    expect(src('supabase/functions/_shared/libraryQueries.ts')).not.toMatch(/from ['"]npm:/);
    expect(src('supabase/functions/_shared/officeText.ts')).not.toMatch(/^import /m);
  });
  it('SQEM-668 — over MCP an Office file\'s pictures follow its text as image blocks; Chat keeps it text', () => {
    const h = MCP.slice(MCP.indexOf("toolName === 'read_context_file'"), MCP.indexOf("toolName === 'download_skill'"));
    const text = h.slice(h.indexOf("delivery === 'text'"), h.indexOf('issueDownloadLinks('));
    expect(text).toMatch(/await lib\.readOfficePictures\(meta\.id, file\.text\)/);
    expect(text).toMatch(/officePicturesNote\(pictures\)/);
    expect(text).toMatch(/pictures\.sent\.map\(p => \(\{ type: 'image', data: p\.base64, mimeType: p\.mime \}\)\)/);
    const chat = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8');
    expect(chat).not.toMatch(/unzipPictures/);
  });
});
