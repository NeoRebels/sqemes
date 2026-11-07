import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import writeExcelFile from 'write-excel-file/node';
import {
  extractOfficeText, officeKindOf, isLegacyOfficeName, isDateFormatCode, excelSerialToIso, decodeXml,
  OfficeReadError, MAX_OFFICE_TEXT_CHARS, type OfficeKind,
} from '../../supabase/functions/_shared/officeText';

// SQEM-658 — real files, made by the same libraries the app uses for its own Office output, read
// back through the reader both the browser and read_context_file use.

async function read(kind: OfficeKind, name: string, bytes: Uint8Array | ArrayBuffer) {
  const zip = await JSZip.loadAsync(bytes);
  return extractOfficeText(kind, name, async p => (zip.file(p) ? zip.file(p)!.async('string') : null));
}

async function wordFile(): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Angebot für Muster GmbH', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: 'Leistungen', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ children: [new TextRun('Preis & Laufzeit: '), new TextRun({ text: '12 Monate', bold: true })] }),
    new Table({ rows: [
      new TableRow({ children: [new TableCell({ children: [new Paragraph('Paket')] }), new TableCell({ children: [new Paragraph('Preis')] })] }),
      new TableRow({ children: [new TableCell({ children: [new Paragraph('Team | Plus')] }), new TableCell({ children: [new Paragraph('99 €')] })] }),
    ] }),
    new Paragraph('Schluss nach der Tabelle.'),
  ] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('SQEM-658 — Word', () => {
  it('headings, runs, a table and the order of the body', async () => {
    const { text, truncated } = await read('docx', 'references/Angebot.docx', await wordFile());
    expect(truncated).toBe(false);
    expect(text.startsWith("File: Angebot.docx (Word document) — converted to text by sqemes (sqemes reader 2); this text is the file's content.\n\n")).toBe(true);
    expect(text).toContain('# Angebot für Muster GmbH');
    expect(text).toContain('## Leistungen');
    expect(text).toContain('Preis & Laufzeit: 12 Monate');
    expect(text).toContain('| Paket | Preis |');
    expect(text).toContain('| Team \\| Plus | 99 € |');
    // The paragraph after the table comes after it, and the table's cells are not repeated as paragraphs.
    expect(text.indexOf('| Paket')).toBeLessThan(text.indexOf('Schluss nach der Tabelle.'));
    expect(text.match(/99 €/g)).toHaveLength(1);
  });
});

describe('SQEM-658 — Excel', () => {
  it('every sheet as CSV, shared strings, numbers, booleans and dates', async () => {
    const bytes = await writeExcelFile([
      { sheet: 'Preise', data: [
        [{ value: 'Produkt' }, { value: 'Preis' }, { value: 'Ab' }, { value: 'Aktiv' }],
        [{ value: 'Team, Plus' }, { value: 99.5 }, { value: new Date(Date.UTC(2026, 10, 5)), format: 'dd.mm.yyyy' }, { value: true }],
      ] },
      { sheet: 'Notizen', data: [[{ value: 'Sagt "hallo"' }]] },
    ]).toBuffer();
    const { text } = await read('xlsx', 'Preisliste.xlsx', bytes);
    expect(text).toContain('File: Preisliste.xlsx (Excel workbook)');
    expect(text).toContain('## Sheet: Preise (2 rows)');
    expect(text).toContain('Produkt,Preis,Ab,Aktiv');
    expect(text).toContain('"Team, Plus",99.5,2026-11-05,TRUE');
    expect(text).toContain('## Sheet: Notizen (1 rows)');
    expect(text).toContain('"Sagt ""hallo"""');
  });

  it('date formats and serials', () => {
    expect(isDateFormatCode('dd.mm.yyyy')).toBe(true);
    expect(isDateFormatCode('hh:mm')).toBe(true);
    expect(isDateFormatCode('#,##0.00')).toBe(false);
    expect(isDateFormatCode('"Tag" 0')).toBe(false);
    expect(isDateFormatCode('[Red]0.00')).toBe(false);
    expect(excelSerialToIso(46331)).toBe('2026-11-05');
    expect(excelSerialToIso(46331.5)).toBe('2026-11-05 12:00');
    expect(excelSerialToIso(44869, true)).toBe('2026-11-05');
  });
});

describe('SQEM-658 — a large workbook (over ten thousand rows, "CPU Time exceeded")', () => {
  it('rows past the text cap are counted, not parsed — the heading still gives the full count', async () => {
    const data = [[{ value: 'Item' }, { value: 'Description' }, { value: 'Condition' }]];
    for (let r = 0; r < 12000; r++) data.push([{ value: `IT-${100000 + r}` }, { value: r % 7 ? 'Touring bike 28 inch with hub gears' : 'Kids bike 20 inch' }, { value: r % 3 ? 'new' : 'used' }]);
    const bytes = await writeExcelFile(data).toBuffer();
    const t = performance.now();
    const { text, truncated } = await read('xlsx', 'stock.xlsx', bytes);
    const ms = performance.now() - t;
    expect(truncated).toBe(true);
    expect(text).toContain('## Sheet: Sheet1 (12,001 rows)');
    expect(text.length).toBeLessThan(MAX_OFFICE_TEXT_CHARS + 1000);
    // Generous on purpose (CI machines vary); the point is "not seconds".
    expect(ms).toBeLessThan(1500);
  });
});

describe('SQEM-658 — the row count ignores formatted empty rows (formatted empty rows counted too)', () => {
  it('past the cap, only rows with a value are counted', async () => {
    const valueRows = Array.from({ length: 12000 }, (_, r) =>
      `<row r="${r + 1}"><c r="A${r + 1}" t="inlineStr"><is><t>Item ${r} Kids bike 20 inch Warehouse A</t></is></c></row>`).join('');
    const emptyRows = Array.from({ length: 5923 }, (_, r) => `<row r="${12001 + r}"><c r="A${12001 + r}" s="1"/><c r="B${12001 + r}" s="1"/></row>`).join('');
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Items" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${valueRows}${emptyRows}</sheetData></worksheet>`);
    const { text, truncated } = await read('xlsx', 'stock.xlsx', await zip.generateAsync({ type: 'uint8array' }));
    expect(truncated).toBe(true);
    expect(text).toContain('## Sheet: Items (12,000 rows)');
  });
});

describe('SQEM-658 — PowerPoint', () => {
  it('slides in order with their notes, not the slide number', async () => {
    const pptx = new PptxGenJS();
    const s1 = pptx.addSlide();
    s1.addText('Willkommen', { x: 1, y: 1, w: 8, h: 1 });
    s1.addNotes('Begrüßung kurz halten');
    const s2 = pptx.addSlide();
    s2.addText('Zweite Folie', { x: 1, y: 1, w: 8, h: 1 });
    const bytes = await pptx.write({ outputType: 'nodebuffer' }) as Uint8Array;
    const { text } = await read('pptx', 'Pitch.pptx', bytes);
    expect(text).toContain('File: Pitch.pptx (PowerPoint presentation)');
    expect(text).toMatch(/## Slide 1\n\nWillkommen\n\nNotes:\nBegrüßung kurz halten/);
    expect(text).toContain('## Slide 2\n\nZweite Folie');
    expect(text.indexOf('Slide 1')).toBeLessThan(text.indexOf('Slide 2'));
  });
});

describe('SQEM-658 — limits and failures', () => {
  it('cuts long text and says so', async () => {
    const long = 'x'.repeat(MAX_OFFICE_TEXT_CHARS + 50);
    const doc = new Document({ sections: [{ children: [new Paragraph(long)] }] });
    const { text, truncated } = await read('docx', 'lang.docx', new Uint8Array(await Packer.toBuffer(doc)));
    expect(truncated).toBe(true);
    expect(text).toMatch(/\[Truncated after 300,000 characters by sqemes\. The file itself is complete/);
    expect(text).toMatch(/never ask for the file again/);
    expect(text).toMatch(/Do not count, sum or search across the whole file/);
  });

  it('a ZIP without the main part is an OfficeReadError, not garbage', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(read('docx', 'fake.docx', bytes)).rejects.toBeInstanceOf(OfficeReadError);
  });

  it('kinds by name, and the old formats are named as such', () => {
    expect(officeKindOf('references/a.DOCX')).toBe('docx');
    expect(officeKindOf('b.xlsx')).toBe('xlsx');
    expect(officeKindOf('c.pptx')).toBe('pptx');
    expect(officeKindOf('d.pdf')).toBeNull();
    expect(officeKindOf('docx')).toBeNull();
    expect(isLegacyOfficeName('alt.doc')).toBe(true);
    expect(isLegacyOfficeName('alt.xls')).toBe(true);
    expect(isLegacyOfficeName('neu.docx')).toBe(false);
  });

  it('XML entities, the ampersand last', () => {
    expect(decodeXml('a &amp;lt; b &lt; c &#228; &#xE4;')).toBe('a &lt; b < c ä ä');
  });
});
