import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import writeExcelFile from 'write-excel-file/node';
import {
  extractOfficeText, officeKindOf, isLegacyOfficeName, isDateFormatCode, excelSerialToIso, decodeXml,
  OfficeReadError, MAX_OFFICE_TEXT_CHARS, type OfficeKind,
  shiftFormula, workbookTables, chartText, smartArtItems, MAX_CHART_ROWS,
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
    expect(text.startsWith("File: Angebot.docx (Word document) — converted to text by sqemes (sqemes reader 3); this text is the file's content.\n\n")).toBe(true);
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

// ── SQEM-659 — formulas, charts, SmartArt and pictures ─────────────────────

const CHART_XML = `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart>
  <c:title><c:tx><c:rich><a:p><a:r><a:t>Umsatz je Quartal</a:t></a:r></a:p></c:rich></c:tx></c:title>
  <c:plotArea><c:barChart><c:barDir val="col"/>
    <c:ser><c:idx val="0"/><c:tx><c:strRef><c:f>Daten!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:cat><c:strRef><c:f>Daten!$A$2:$A$3</c:f><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f>Daten!$B$2:$B$3</c:f><c:numCache><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>150</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
    <c:ser><c:idx val="1"/><c:tx><c:v>2026</c:v></c:tx>
      <c:val><c:numRef><c:f>Daten!$C$2:$C$3</c:f><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>180</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
    <c:ser><c:idx val="2"/><c:tx><c:v>Plan</c:v></c:tx><c:val><c:numRef><c:f>Daten!$D$2:$D$3</c:f></c:numRef></c:val></c:ser>
  </c:barChart>
  <c:catAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Quartal</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx>
  <c:valAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Euro</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
  </c:plotArea></c:chart></c:chartSpace>`;

const SMARTART_DATA = `<dgm:dataModel xmlns:dgm="d" xmlns:a="a"><dgm:ptLst>
  <dgm:pt modelId="0" type="doc"><dgm:t><a:p><a:r><a:t>ignored</a:t></a:r></a:p></dgm:t></dgm:pt>
  <dgm:pt modelId="1"><dgm:t><a:p><a:r><a:t>Anfrage</a:t></a:r></a:p></dgm:t></dgm:pt>
  <dgm:pt modelId="2" type="parTrans"/>
  <dgm:pt modelId="3"><dgm:t><a:p><a:r><a:t>Angebot</a:t></a:r></a:p></dgm:t></dgm:pt>
  <dgm:pt modelId="4" type="pres"><dgm:t><a:p><a:r><a:t>layout</a:t></a:r></a:p></dgm:t></dgm:pt>
</dgm:ptLst></dgm:dataModel>`;

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('SQEM-659 — formulas next to their stored value', () => {
  it('shiftFormula moves relative references, keeps $ parts, strings, functions and other sheets intact', () => {
    expect(shiftFormula('SUM(B2:B9)', 0, 1)).toBe('SUM(C2:C9)');
    expect(shiftFormula('A1*$B$1+$C2+D$3', 2, 1)).toBe('B3*$B$1+$C4+E$3');
    expect(shiftFormula('IF(A2>0,"A1 bleibt",LOG10(A2))', 1, 0)).toBe('IF(A3>0,"A1 bleibt",LOG10(A3))');
    expect(shiftFormula("'Preise 2026'!B2*Daten!C3", 1, 0)).toBe("'Preise 2026'!B3*Daten!C4");
    expect(shiftFormula('Z1+AA1', 0, 1)).toBe('AA1+AB1');
  });

  const workbook = () => zipOf({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Daten" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Menge</t></is></c><c r="B1" t="inlineStr"><is><t>Preis</t></is></c><c r="C1" t="inlineStr"><is><t>Summe</t></is></c></row>
      <row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>10</v></c><c r="C2"><f t="shared" ref="C2:C3" si="0">A2*B2</f><v>20</v></c></row>
      <row r="3"><c r="A3"><v>3</v></c><c r="B3"><v>5</v></c><c r="C3"><f t="shared" si="0"/><v>15</v></c></row>
      <row r="4"><c r="C4"><f>SUM(C2:C3)</f><v>35</v></c><c r="D4"><f>NOW()</f></c></row>
    </sheetData><drawing r:id="rId1"/></worksheet>`,
    'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://x/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    'xl/drawings/drawing1.xml': `<xdr:wsDr>
      <xdr:twoCellAnchor><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Diagramm 1"/></xdr:nvGraphicFramePr><a:graphic><a:graphicData><c:chart xmlns:c="c" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>
      <xdr:twoCellAnchor><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Bild 2" descr="Firmenlogo"/></xdr:nvPicPr></xdr:pic></xdr:twoCellAnchor>
    </xdr:wsDr>`,
    'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://x/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
    'xl/charts/chart1.xml': CHART_XML,
  });

  it('the value with its formula, shared formulas resolved per cell, a formula without a stored value', async () => {
    const { text } = await read('xlsx', 'Kalkulation.xlsx', await workbook());
    expect(text).toContain('(sqemes reader 3)');
    expect(text).toContain('2,10,20 (=A2*B2)');
    expect(text).toContain('3,5,15 (=A3*B3)');
    expect(text).toContain(',,35 (=SUM(C2:C3)),=NOW()');
  });

  it('the sheet\'s chart with its stored data, and its picture, after the rows', async () => {
    const { text } = await read('xlsx', 'Kalkulation.xlsx', await workbook());
    expect(text).toContain('Chart: Umsatz je Quartal (bar chart; axes: Quartal / Euro)');
    expect(text).toContain('| Category | 2025 | 2026 |');
    expect(text).toContain('| Q1 | 100 | 120 |');
    expect(text).toContain('| Q2 | 150 | 180 |');
    expect(text).toContain('- Plan: no stored values, from Daten!$D$2:$D$3');
    expect(text).toContain('[Image: Firmenlogo]');
    expect(text.indexOf('```csv')).toBeLessThan(text.indexOf('Chart:'));
  });

  it('⛔ the data analysis still gets values only — never a formula', async () => {
    const zip = await JSZip.loadAsync(await workbook());
    const tables = await workbookTables(async p => (zip.file(p) ? zip.file(p)!.async('string') : null));
    // D4 holds only a formula and no stored value: an empty cell for the analysis.
    expect(tables[0].csv).toBe('Menge,Preis,Summe\n2,10,20\n3,5,15\n,,35,');
    expect(tables[0].csv).not.toContain('=');
  });
});

describe('SQEM-659 — Word: chart, SmartArt and picture where they sit', () => {
  it('in document order, between the paragraphs around them', async () => {
    const drawing = (inner: string) => `<w:p><w:r><w:drawing><wp:inline>${inner}</wp:inline></w:drawing></w:r></w:p>`;
    const bytes = await zipOf({
      'word/document.xml': `<w:document><w:body>
        <w:p><w:r><w:t>Vor dem Diagramm</w:t></w:r></w:p>
        ${drawing('<wp:docPr id="1" name="Diagramm 1"/><a:graphic><a:graphicData><c:chart xmlns:c="c" r:id="rId5"/></a:graphicData></a:graphic>')}
        <w:p><w:r><w:t>Ablauf</w:t></w:r></w:p>
        ${drawing('<wp:docPr id="2" name="Diagramm 2"/><a:graphic><a:graphicData><dgm:relIds xmlns:dgm="d" r:dm="rId6" r:lo="rId7"/></a:graphicData></a:graphic>')}
        ${drawing('<wp:docPr id="3" name="Grafik 3" descr="Teamfoto"/><a:graphic><a:graphicData><pic:pic xmlns:pic="p"/></a:graphicData></a:graphic>')}
        <w:p><w:r><w:t>Ende</w:t></w:r></w:p>
      </w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships>
        <Relationship Id="rId5" Type="x/chart" Target="charts/chart1.xml"/>
        <Relationship Id="rId6" Type="x/diagramData" Target="diagrams/data1.xml"/></Relationships>`,
      'word/charts/chart1.xml': CHART_XML,
      'word/diagrams/data1.xml': SMARTART_DATA,
    });
    const { text } = await read('docx', 'Bericht.docx', bytes);
    expect(text).toContain('| Q2 | 150 | 180 |');
    expect(text).toContain('SmartArt:\n- Anfrage\n- Angebot');
    expect(text).not.toContain('layout');
    expect(text).not.toContain('ignored');
    expect(text).toContain('[Image: Teamfoto]');
    const order = ['Vor dem Diagramm', 'Chart: Umsatz', 'Ablauf', 'SmartArt:', '[Image: Teamfoto]', 'Ende'].map(s => text.indexOf(s));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
  });
});

describe('SQEM-659 — PowerPoint: a real chart and a picture on a slide', () => {
  it('the chart\'s data from pptxgenjs, and the picture marker', async () => {
    const pptx = new PptxGenJS();
    const s = pptx.addSlide();
    s.addText('Zahlen', { x: 1, y: 0.3, w: 8, h: 1 });
    s.addChart(pptx.ChartType.bar, [{ name: 'Leads', labels: ['Jan', 'Feb'], values: [12, 30] }], { x: 1, y: 1.5, w: 6, h: 3, showTitle: true, title: 'Leads je Monat' });
    s.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', x: 7, y: 1, w: 1, h: 1, altText: 'Logo' });
    const bytes = await pptx.write({ outputType: 'nodebuffer' }) as Uint8Array;
    const { text } = await read('pptx', 'Vertrieb.pptx', bytes);
    expect(text).toMatch(/## Slide 1\n\nZahlen\n\nChart: Leads je Monat \(bar chart/);
    expect(text).toContain('| Category | Leads |');
    expect(text).toContain('| Jan | 12 |');
    expect(text).toContain('| Feb | 30 |');
    expect(text).toContain('[Image: Logo]');
  });
});

describe('SQEM-659 — chart limits', () => {
  it('a chart over thousands of points shows the first ones and says how many more', () => {
    const pts = Array.from({ length: 250 }, (_, i) => `<c:pt idx="${i}"><c:v>${i}</c:v></c:pt>`).join('');
    const md = chartText(`<c:chartSpace><c:chart><c:plotArea><c:lineChart><c:ser><c:val><c:numRef><c:numCache>${pts}</c:numCache></c:numRef></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>`);
    expect(md).toContain('Chart (line chart)');
    expect(md.split('\n').filter(l => l.startsWith('| ')).length).toBe(MAX_CHART_ROWS + 2); // header, separator, rows
    expect(md).toContain('(50 more points not shown)');
  });
  it('SmartArt keeps node text only', () => {
    expect(smartArtItems(SMARTART_DATA)).toEqual(['Anfrage', 'Angebot']);
  });
});
