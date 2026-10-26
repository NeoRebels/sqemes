import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { normalizeDocumentStyle, effectiveStyle, STYLE_PARAMETER } from '../../supabase/functions/_shared/documentStyle';
import { validateFileRequest, normalizeGeneratedFiles, CREATE_FILE_DEFINITION } from '../../supabase/functions/_shared/fileOutput';
import { buildFile, pdfDefinition, pdfFontFor, type LogoImage, type PdfFontFiles } from '../../lib/fileExport';
import { findLogoFile } from '../../lib/logoMatch';
import type { WorkspaceFile } from '../../types';

/**
 * SQEM-597 — how a Chat file looks: a validated style (colour, font, logo, header, footer, page size),
 * workspace default under the file's own style. The files are built and READ BACK, not assumed.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

// A real 2×1 red PNG, so the writers embed an actual image.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAN9gH/cMTNXQAAAABJRU5ErkJggg==', 'base64'));
const LOGO: LogoImage = { data: PNG, type: 'png', dataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`, width: 200, height: 100, pdfDataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` };
const STYLE = { primaryColor: '#0A5C8F', font: 'Arial' as const, header: 'Vertraulich', footer: 'Müller GmbH · Hauptstraße 1', pageSize: 'Letter' as const, logo: 'brand/logo.png' };
const DOC = '# Angebot\n\nFür **Müller GmbH**.\n\n## Positionen\n\n| Position | Preis |\n|---|---|\n| Beratung | 1.250,50 |\n';

const fonts = (dir: string, prefix: string): PdfFontFiles => {
  const b = (v: string) => readFileSync(resolve(ROOT, `node_modules/@fontsource/${dir}/files/${prefix}-latin-${v}.woff`)).toString('base64');
  return { normal: b('400-normal'), bold: b('700-normal'), italics: b('400-italic'), bolditalics: b('700-italic') };
};
const loadFont = async (f: 'Open Sans' | 'Lato') => (f === 'Lato' ? fonts('lato', 'lato') : fonts('open-sans', 'open-sans'));
const unzip = async (b: Blob) => JSZip.loadAsync(await b.arrayBuffer());
const allXml = async (zip: JSZip, re: RegExp) => (await Promise.all(Object.keys(zip.files).filter(n => re.test(n)).map(n => zip.file(n)!.async('string')))).join('\n');

describe('normalizeDocumentStyle', () => {
  it('keeps valid fields, normalises them, drops the rest', () => {
    expect(normalizeDocumentStyle({ primaryColor: '0a5c8f', font: 'arial', pageSize: 'letter', header: '  a   b ', evil: '<script>' }))
      .toEqual({ primaryColor: '#0A5C8F', font: 'Arial', pageSize: 'Letter', header: 'a b' });
  });
  it('⛔ invalid values never pass: a colour that is not #RRGGBB, an unknown font, an unknown page size', () => {
    expect(normalizeDocumentStyle({ primaryColor: 'red', font: 'Comic Sans', pageSize: 'A3' })).toBeNull();
    expect(normalizeDocumentStyle({ primaryColor: '#0A5C8F;background:url(x)' })).toBeNull();
    expect(normalizeDocumentStyle('x')).toBeNull();
    expect(normalizeDocumentStyle([1])).toBeNull();
  });
  it('caps header and footer', () => {
    expect(normalizeDocumentStyle({ header: 'x'.repeat(500) })!.header!.length).toBe(120);
    expect(normalizeDocumentStyle({ footer: 'x'.repeat(500) })!.footer!.length).toBe(200);
  });
  it('the file style wins over the workspace default, field by field', () => {
    expect(effectiveStyle({ primaryColor: '#C8102E' }, { primaryColor: '#0A5C8F', font: 'Lato' })).toEqual({ primaryColor: '#C8102E', font: 'Lato' });
    expect(effectiveStyle(null, null)).toEqual({});
  });
});

describe('create_file carries a style', () => {
  it('validated on the way in; a bad field is dropped, the file is not refused', () => {
    const r = validateFileRequest({ name: 'A', format: 'docx', content: '# x', style: { primaryColor: '#0a5c8f', font: 'Wingdings' } });
    expect('file' in r && r.file.style).toEqual({ primaryColor: '#0A5C8F' });
  });
  it('kept when the stored answer is read back', () => {
    expect(normalizeGeneratedFiles([{ name: 'a', format: 'pdf', content: 'x', style: { primaryColor: '#123456' } }])[0].style).toEqual({ primaryColor: '#123456' });
  });
  it('the parameter stays inside the schema subset every provider accepts', () => {
    expect(JSON.stringify(STYLE_PARAMETER)).not.toMatch(/enum|oneOf|additionalProperties|\$schema/);
    expect((CREATE_FILE_DEFINITION.parameters.properties as Record<string, unknown>).style).toBe(STYLE_PARAMETER);
    expect(CREATE_FILE_DEFINITION.parameters.required).not.toContain('style');
  });
});

describe('PDF', () => {
  it('only Roboto, Open Sans and Lato are embeddable; anything else falls back to Roboto', () => {
    expect(pdfFontFor({ font: 'Calibri' })).toBe('Roboto');
    expect(pdfFontFor({ font: 'Lato' })).toBe('Lato');
    expect(pdfFontFor({})).toBe('Roboto');
  });
  it('colour on headings and the table header, header + footer, Letter', () => {
    const def = pdfDefinition(DOC, 'Angebot', STYLE, LOGO) as Record<string, any>;
    expect(def.styles.h1.color).toBe('#0A5C8F');
    expect(def.pageSize).toBe('LETTER');
    const table = def.content.find((n: Record<string, unknown>) => 'table' in n);
    expect(table.table.body[0][0]).toMatchObject({ fillColor: '#0A5C8F', color: '#FFFFFF' });
    expect(JSON.stringify(def.header())).toMatch(/Vertraulich/);
    expect(JSON.stringify(def.header())).toMatch(/data:image\/png/);
    expect(JSON.stringify(def.footer(2, 5))).toMatch(/Müller GmbH · Hauptstraße 1.*2 \/ 5/);
  });
  it('⛔ a transparent PNG never reaches pdfmake: without the flattened JPEG the PDF leaves the logo out', () => {
    const { pdfDataUrl: _drop, ...noFlat } = LOGO;
    const def = pdfDefinition(DOC, 'A', { header: 'H' }, noFlat) as Record<string, any>;
    expect(JSON.stringify(def.header())).not.toMatch(/data:image/);
    expect(JSON.stringify((pdfDefinition(DOC, 'A', {}, LOGO) as Record<string, any>).header())).toMatch(/data:image/);
  });

  it('a real PDF with a transparent logo builds — the flattened copy is what goes in', async () => {
    const rgba = new Uint8Array(readFileSync(resolve(ROOT, 'public/logo-primary-V2.png')));
    const logo: LogoImage = { data: rgba, type: 'png', dataUrl: `data:image/png;base64,${Buffer.from(rgba).toString('base64')}`, width: 500, height: 95, pdfDataUrl: LOGO.pdfDataUrl };
    const blob = await buildFile({ name: 'a.pdf', format: 'pdf', content: DOC }, { style: { header: 'H' }, logo });
    expect(Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a real PDF embeds Open Sans when chosen', async () => {
    const blob = await buildFile({ name: 'a.pdf', format: 'pdf', content: DOC }, { style: { font: 'Open Sans' }, pdfFontFiles: loadFont });
    expect(Buffer.from(await blob.arrayBuffer()).toString('latin1')).toMatch(/\/BaseFont \/[A-Z]+\+OpenSans/);
  });
});

describe('Word', () => {
  it('font, heading colour, table header, logo + header text, footer, Letter — read back from the file', async () => {
    const zip = await unzip(await buildFile({ name: 'a.docx', format: 'docx', content: DOC }, { style: STYLE, logo: LOGO }));
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toMatch(/w:ascii="Arial"/);
    expect(styles).toMatch(/w:color w:val="0A5C8F"/);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toMatch(/w:fill="0A5C8F"/);
    expect(doc).toMatch(/w:w="12240"/);
    expect(await allXml(zip, /^word\/header\d*\.xml$/)).toMatch(/Vertraulich/);
    expect(await allXml(zip, /^word\/footer\d*\.xml$/)).toMatch(/Müller GmbH · Hauptstraße 1/);
    expect(Object.keys(zip.files).some(n => /^word\/media\/.+\.png$/.test(n))).toBe(true);
  });
});

describe('PowerPoint', () => {
  it('title colour, font, logo on every slide, footer', async () => {
    const zip = await unzip(await buildFile({ name: 'a.pptx', format: 'pptx', content: DOC }, { style: STYLE, logo: LOGO }));
    const slides = await allXml(zip, /^ppt\/slides\/slide\d+\.xml$/);
    expect(slides).toMatch(/srgbClr val="0A5C8F"/);
    expect(slides).toMatch(/typeface="Arial"/);
    expect(slides).toMatch(/Müller GmbH · Hauptstraße 1/);
    expect(Object.keys(zip.files).filter(n => /^ppt\/media\//.test(n)).length).toBeGreaterThan(0);
  });
});

describe('Excel', () => {
  it('header row in the house colour, font on the cells', async () => {
    const zip = await unzip(await buildFile({ name: 'a.xlsx', format: 'xlsx', content: DOC }, { style: STYLE }));
    const styles = await zip.file('xl/styles.xml')!.async('string');
    expect(styles).toMatch(/0A5C8F/i);
    expect(styles).toMatch(/Arial/);
  });
});

describe('logo by file name', () => {
  const file = (name: string, mimeType = 'image/png') => ({ id: name, workspaceId: 'w', name, mimeType, sizeBytes: 1, storagePath: `w/${name}`, tags: [], createdBy: 'u', createdAt: '' }) as WorkspaceFile;
  const files = [file('brand/logo.png'), file('other/Logo-Dark.PNG'), file('notes.md', 'text/markdown')];
  it('exact name first, then the bare file name, case-insensitive', () => {
    expect(findLogoFile('brand/logo.png', files)?.name).toBe('brand/logo.png');
    expect(findLogoFile('LOGO.png', files)?.name).toBe('brand/logo.png');
    expect(findLogoFile('logo-dark.png', files)?.name).toBe('other/Logo-Dark.PNG');
    expect(findLogoFile('missing.png', files)).toBeNull();
  });
  it('⛔ only from the files this person can see — the list the page already has', () => {
    expect(read('lib/logoImage.ts')).toMatch(/export async function loadLogo\(name: string, files: WorkspaceFile\[\]\)/);
    expect(read('pages/Chat.tsx')).toMatch(/workspaceStyle=\{workspace\.documentStyle\} files=\{workspaceFiles\}/);
  });
});

describe('the workspace default', () => {
  const sql = read('supabase/migrations/20261026220000_sqem597_document_style.sql');
  it('⛔ admins only: column grant + a guard that keeps the old value for anyone else', () => {
    expect(sql).toMatch(/grant update \(document_style\) on public\.workspaces to authenticated/);
    expect(sql).toMatch(/public\.get_user_role\(old\.id\) is distinct from 'admin'/);
    expect(sql).toMatch(/new\.document_style := old\.document_style/);
    expect(sql).toMatch(/jsonb_typeof\(document_style\) = 'object' and octet_length\(document_style::text\) <= 4096/);
  });
  it('read back through the same validation the files use', () => {
    expect(read('lib/api/workspaces.ts')).toMatch(/documentStyle: normalizeDocumentStyle\(/);
  });
  it('⛔ the PDF fonts load on demand only', () => {
    expect(read('lib/fileExport.ts')).toMatch(/await import\('\.\/pdfFonts'\)/);
    expect(read('lib/fileExport.ts')).not.toMatch(/^import .*pdfFonts/m);
  });
});
