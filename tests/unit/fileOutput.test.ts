import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import {
  validateFileRequest, withFileTool, normalizeGeneratedFiles, fileNameFor, hasMarkdownTable,
  CREATE_FILE_DEFINITION, MAX_FILES_PER_ANSWER, MAX_FILE_CHARS, type GeneratedFile,
} from '../../supabase/functions/_shared/fileOutput';
import { sheetsFromMarkdown, cellValue, plainTextFromMarkdown, pdfDefinition, buildFile, slidesFromMarkdown, MAX_BULLETS_PER_SLIDE } from '../../lib/fileExport';
import type { ToolRuntime } from '../../supabase/functions/_shared/libraryTools';

/**
 * SQEM-595 — Chat hands out files (md, txt, docx, pdf, xlsx): the server checks and records a
 * description, the browser builds the file on download. Download only, nothing stored.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments: a block-first stripper can swallow code after a glob in a line comment.
const code = (src: string) => src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const DOC = `# Angebot für Müller GmbH

Sehr geehrte Frau **Öztürk**, anbei unser Angebot.

## Positionen

| Position | Menge | Preis |
|---|---|---|
| Beratung | 3 | 1.250,50 |
| Workshop | 1 | 900 |

- erster Punkt
- zweiter Punkt
`;

describe('validateFileRequest', () => {
  it('accepts the five formats and gives the name the right extension', () => {
    for (const format of ['md', 'txt', 'docx', 'pdf'] as const) {
      const r = validateFileRequest({ name: 'Angebot Müller', format, content: '# Hi' });
      expect('file' in r && r.file.name).toBe(`Angebot Müller.${format}`);
    }
    expect('file' in validateFileRequest({ name: 'Zahlen', format: 'xlsx', content: DOC })).toBe(true);
  });

  it('refuses with a reason the model can act on', () => {
    expect(validateFileRequest({ name: 'x', format: 'exe', content: 'a' })).toEqual({ error: expect.stringMatching(/format must be one of/) });
    expect(validateFileRequest({ name: 'x', format: 'pdf', content: '  ' })).toEqual({ error: expect.stringMatching(/content is empty/) });
    expect(validateFileRequest({ name: 'x', format: 'pdf', content: 'a'.repeat(MAX_FILE_CHARS + 1) })).toEqual({ error: expect.stringMatching(/too long/) });
    expect(validateFileRequest({ name: 'x', format: 'xlsx', content: 'no table here' })).toEqual({ error: expect.stringMatching(/Markdown table/) });
    expect(validateFileRequest({ name: 'x', format: 'pptx', content: 'no heading here' })).toEqual({ error: expect.stringMatching(/"## " heading/) });
    expect('file' in validateFileRequest({ name: 'Deck', format: 'pptx', content: '## Eins\n- a' })).toBe(true);
  });

  it('cleans names: no path, no reserved characters, no double extension, never empty', () => {
    expect(fileNameFor('../../etc/passwd', 'txt')).toBe('etc passwd.txt');
    expect(fileNameFor(' ..hidden', 'md')).toBe('hidden.md');
    expect(fileNameFor('a/b:c*?.docx', 'docx')).toBe('a b c.docx');
    expect(fileNameFor('', 'pdf')).toBe('document.pdf');
    expect(fileNameFor('Bericht.pdf', 'pdf')).toBe('Bericht.pdf');
    expect(fileNameFor('../x', 'md')).not.toMatch(/\//);
  });

  it('recognises a GFM table', () => {
    expect(hasMarkdownTable(DOC)).toBe(true);
    expect(hasMarkdownTable('a | b')).toBe(false);
  });
});

function baseRuntime(): ToolRuntime {
  return {
    definitions: [], maxRounds: 6, deadline: Date.now() + 60_000,
    execute: vi.fn(async (name: string) => `other:${name}`),
    stats: { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false } as ToolRuntime['stats'],
  };
}

describe('withFileTool', () => {
  it('adds create_file, records accepted files, passes other tools through', async () => {
    const files: GeneratedFile[] = [];
    const rt = withFileTool(baseRuntime(), files);
    expect(rt.definitions.map(d => d.name)).toEqual(['create_file']);
    expect(await rt.execute('create_file', { name: 'A', format: 'docx', content: DOC })).toMatch(/File created: A\.docx/);
    expect(await rt.execute('create_file', { name: 'B', format: 'md', content: DOC })).toMatch(/Do not write a link or URL to it/);
    expect(await rt.execute('search_templates', {})).toBe('other:search_templates');
    expect(files).toHaveLength(2);
  });

  it('a refusal is the tool answer, nothing recorded', async () => {
    const files: GeneratedFile[] = [];
    expect(await withFileTool(baseRuntime(), files).execute('create_file', { name: 'A', format: 'xlsx', content: 'x' })).toMatch(/^create_file refused:/);
    expect(files).toEqual([]);
  });

  it(`stops at ${MAX_FILES_PER_ANSWER} files per answer`, async () => {
    const files: GeneratedFile[] = [];
    const rt = withFileTool(baseRuntime(), files);
    for (let i = 0; i < MAX_FILES_PER_ANSWER + 1; i++) await rt.execute('create_file', { name: `F${i}`, format: 'md', content: '# x' });
    expect(files).toHaveLength(MAX_FILES_PER_ANSWER);
  });

  it('pptx guidance: one file for all slides (seen in testing: one file per slide)', () => {
    expect(CREATE_FILE_DEFINITION.description).toMatch(/ALL slides into ONE file with ONE create_file call/);
    // A request for "a presentation" (not "a PowerPoint file") went unanswered by a small model in testing.
    expect(CREATE_FILE_DEFINITION.description).toMatch(/a presentation or slides \(pptx\)/);
  });

  it('the definition stays inside the schema subset Gemini accepts', () => {
    expect(JSON.stringify(CREATE_FILE_DEFINITION)).not.toMatch(/additionalProperties|\$schema|oneOf|enum/);
  });

  it('normalizeGeneratedFiles drops unknown formats and junk', () => {
    expect(normalizeGeneratedFiles([{ name: 'a', format: 'pdf', content: 'x' }, { name: 'b', format: 'exe', content: 'x' }, 'junk']))
      .toEqual([{ name: 'a.pdf', format: 'pdf', content: 'x' }]);
    expect(normalizeGeneratedFiles(null)).toEqual([]);
  });
});

describe('lib/fileExport', () => {
  it('every table is a sheet, named after the heading above it', () => {
    const sheets = sheetsFromMarkdown(DOC);
    expect(sheets).toEqual([{ name: 'Positionen', rows: [['Position', 'Menge', 'Preis'], ['Beratung', '3', '1.250,50'], ['Workshop', '1', '900']] }]);
  });

  it('sheet names: Excel-safe, ≤ 31 characters, unique', () => {
    const md = '## Q1/Q2: Umsatz [netto] und noch sehr viel mehr Text\n\n|a|\n|---|\n|1|\n\n## Q1/Q2: Umsatz [netto] und noch sehr viel mehr Text\n\n|a|\n|---|\n|2|\n';
    const names = sheetsFromMarkdown(md).map(s => s.name);
    expect(names.every(n => n.length <= 31 && !/[[\]:*?/\\]/.test(n))).toBe(true);
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(2);
  });

  it('numbers become numbers, German and English notation; codes with leading zeros stay text', () => {
    expect(cellValue('1.250,50')).toBe(1250.5);
    expect(cellValue('3,5')).toBe(3.5);
    expect(cellValue('900')).toBe(900);
    expect(cellValue('-2.5')).toBe(-2.5);
    expect(cellValue('00123')).toBe('00123');
    expect(cellValue('Beratung')).toBe('Beratung');
  });

  it('txt is the document without Markdown syntax', () => {
    const t = plainTextFromMarkdown(DOC);
    expect(t).toMatch(/^Angebot für Müller GmbH\n/);
    expect(t).toMatch(/Frau Öztürk, anbei/);
    expect(t).not.toMatch(/\*\*|##|\|---/);
  });

  it('pdf: headings styled, the table has a header row, links survive', () => {
    const def = pdfDefinition(`${DOC}\nSiehe [Quelle](https://example.org).`, 'Angebot') as { content: Record<string, unknown>[] };
    expect(def.content[0]).toMatchObject({ style: 'h1' });
    expect(def.content.find(n => 'table' in n)).toMatchObject({ table: { headerRows: 1 } });
    expect(JSON.stringify(def.content)).toMatch(/"link":"https:\/\/example\.org"/);
  });

  it('docx: a real Word file with umlauts, bold and the table', async () => {
    const blob = await buildFile({ name: 'Angebot.docx', format: 'docx', content: DOC });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/Angebot für Müller GmbH/);
    expect(xml).toMatch(/Öztürk/);
    expect(xml).toMatch(/<w:tbl>/);
    expect(xml).toMatch(/<w:b\/>/);
  });

  it('xlsx: a real Excel file, one sheet per table, named after the heading', async () => {
    const md = '# Produkte\n\n| Name | Preis |\n|---|---|\n| Laptop | 999.99 |\n\n# Kunden\n\n| Firma | Ort |\n|---|---|\n| Müller GmbH | München |\n';
    const blob = await buildFile({ name: 'Liste.xlsx', format: 'xlsx', content: md });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    expect(workbook).toMatch(/name="Produkte"/);
    expect(workbook).toMatch(/name="Kunden"/);
    const all = (await Promise.all(Object.keys(zip.files).filter(n => /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(n)).map(n => zip.file(n)!.async('string')))).join('');
    expect(all).toMatch(/Müller GmbH/);
    expect(all).toMatch(/999\.99/);
  });

  it('pptx: title slide, one slide per ##, tables kept, long slides continue', () => {
    const md = `# Strategie 2027\n\nKick-off für die Müller GmbH\n\n## Ziele\n\n- Umsatz steigern\n  - in DACH\n- Kosten senken\n\n## Zahlen\n\n| Jahr | Umsatz |\n|---|---|\n| 2026 | 1,2 Mio |\n\n## Lang\n\n${Array.from({ length: MAX_BULLETS_PER_SLIDE + 3 }, (_, i) => `- Punkt ${i + 1}`).join('\n')}\n`;
    const slides = slidesFromMarkdown(md);
    expect(slides[0]).toMatchObject({ isTitle: true, title: 'Strategie 2027', subtitle: 'Kick-off für die Müller GmbH' });
    expect(slides[1]).toMatchObject({ title: 'Ziele', bullets: [{ text: 'Umsatz steigern', level: 0 }, { text: 'in DACH', level: 1 }, { text: 'Kosten senken', level: 0 }] });
    expect(slides[2].table).toEqual([['Jahr', 'Umsatz'], ['2026', '1,2 Mio']]);
    expect(slides.slice(3).map(s => s.title)).toEqual(['Lang', 'Lang (cont.)']);
    expect(slides[3].bullets).toHaveLength(MAX_BULLETS_PER_SLIDE);
  });

  it('pptx: a real PowerPoint file with one slide per title and the umlauts in it', async () => {
    const md = '# Strategie 2027\n\nKick-off für die Müller GmbH\n\n## Ziele\n\n- Umsatz steigern\n\n## Zahlen\n\n| Jahr | Umsatz |\n|---|---|\n| 2026 | 1,2 Mio |\n';
    const blob = await buildFile({ name: 'Deck.pptx', format: 'pptx', content: md });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(3);
    const xml = (await Promise.all(slides.map(n => zip.file(n)!.async('string')))).join('');
    expect(xml).toMatch(/Kick-off für die Müller GmbH/);
    expect(xml).toMatch(/<a:tbl>/);
  });

  it('md is the Markdown as it is', async () => {
    expect(await (await buildFile({ name: 'a.md', format: 'md', content: DOC })).text()).toBe(DOC);
  });
});

describe('wiring', () => {
  it('chat-message offers create_file to every text model and sends the files with the result', () => {
    const chat = code(read('supabase/functions/chat-message/index.ts'));
    expect(chat).toMatch(/if \(base\) base = withFileTool\(base, generatedFiles\);/);
    expect(chat).toMatch(/\{ generatedFiles \}/);
  });

  it('Chat stores the files with the answer and opens the preview from the card', () => {
    const page = code(read('pages/Chat.tsx'));
    expect(page).toMatch(/assistantMsgId, \{ loadedTemplateIds, libraryChanges, webSources, generatedFiles \}\)/);
    expect(page).toMatch(/<GeneratedFilesCard files=\{msg\.generatedFiles\} onOpen=\{onOpenFile\} \/>/);
    expect(page).toMatch(/<FilePreviewPanel file=\{previewFile\}/);
  });

  it('⛔ the heavy libraries load on download only — never with the Chat page', () => {
    const lib = read('lib/fileExport.ts');
    expect(lib).toMatch(/await import\('docx'\)/);
    expect(lib).toMatch(/import\('pdfmake\/build\/pdfmake'\)/);
    expect(lib).toMatch(/await import\('write-excel-file\/browser'\)/);
    expect(lib).toMatch(/await import\('pptxgenjs'\)/); // SQEM-596
    expect(lib).not.toMatch(/^import .* from '(docx|pdfmake|write-excel-file|pptxgenjs)/m);
  });

  it('⛔ the migration: assistant only, at most 5 files, size-capped', () => {
    const sql = read('supabase/migrations/20261026210000_sqem595_generated_files.sql');
    expect(sql).toMatch(/role = 'assistant'/);
    expect(sql).toMatch(/jsonb_array_length\(generated_files\) <= 5/);
    expect(sql).toMatch(/octet_length\(generated_files::text\) <= 3145728/);
  });
});
