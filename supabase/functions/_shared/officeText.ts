// SQEM-658 — the text of a Word, Excel or PowerPoint file, as Markdown a model can read.
//
// ⛔ Why this exists: before it, an Office file in sqemes was storable and producible but not
// readable. A chat attachment was refused; a context file came back from `read_context_file` as a
// download link — which sqemes Chat cannot open (no code runtime, by guardrail) and which an MCP
// client can only open with a sandbox that has network. So the knowledge a team keeps in Word and
// Excel never reached the answer, in exactly the channels sqemes exists for.
//
// ONE reader, run in two places: the browser for chat attachments (no server CPU — an edge function
// has little pure compute time, and a 15 MB workbook is real work), the server for context files
// (`read_context_file`, Chat and MCP). Same output everywhere, one place to fix.
//
// Plain TypeScript with no Deno or browser API and NO import: the caller unzips (jszip on both
// sides) and hands in a reader for one entry. No DOMParser either — Deno has none — so the XML is
// scanned with indexOf and small regexes. That is deliberate and enough for the three formats' main
// parts; it is not a general XML parser and must not become one.
//
// Deliberately not: .doc/.xls/.ppt (binary formats), pictures and charts, formulas (the stored
// value is what counts), text boxes and footnotes beyond what sits inside a body paragraph.

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

/**
 * Bumped whenever the reader's OUTPUT changes. Stored texts (`workspace_file_texts`) carry the marker;
 * one without the current marker is re-read. ⛔ Without it, v1's wrong row count stayed in the
 * database after the fix.
 */
export const OFFICE_READER_MARKER = '(sqemes reader 2)';

/**
 * The largest Office file the SERVER reads live, when no stored text exists (an MCP upload). Above it
 * the text is prepared in a browser — at upload in the app, or on the next visit to the Files page by
 * an admin or editor — because an edge function has ~2 s of CPU. ⚠️ An assumption with one data point:
 * a workbook of a few MB passed after the faster reader, it had failed before. Re-measure before raising.
 */
export const OFFICE_SERVER_READ_MAX_BYTES = 5 * 1024 * 1024;

/** What an MCP upload is told about an Office file, so the uploader knows when it reads as text. */
export function officeUploadNote(name: string, sizeBytes: number): string | undefined {
  if (!officeKindOf(name)) return undefined;
  return sizeBytes <= OFFICE_SERVER_READ_MAX_BYTES
    ? 'Readable as text: read_context_file returns its text, tables and slides as Markdown.'
    : 'Stored. Too large to read as text on the server right away: its text is prepared the next time an admin or editor opens Files in the sqemes app. Until then read_context_file says so; as: "file" gives the original.';
}

/** Past this the text is cut, with a sentence saying so (~75,000 tokens). */
export const MAX_OFFICE_TEXT_CHARS = 300_000;

/** The kind by file extension — the only way an attachment or a stored binary announces itself. */
export function officeKindOf(name: string): OfficeKind | null {
  // Same rule as extensionOf (skillFile.ts): a name without a dot, or with only a leading one, has none.
  const base = String(name ?? '').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null;
}

/** The old binary formats — named so the caller can say "save as .docx" instead of "unsupported". */
export function isLegacyOfficeName(name: string): boolean {
  return /\.(doc|xls|ppt)$/i.test(String(name ?? ''));
}

export const OFFICE_MIME: Record<OfficeKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const KIND_LABEL: Record<OfficeKind, string> = { docx: 'Word document', xlsx: 'Excel workbook', pptx: 'PowerPoint presentation' };

/** A file that is not what its name says, damaged, or password-protected (those are not ZIPs). */
export class OfficeReadError extends Error {}

/** Reads one entry of the unzipped file as text, or null when the entry does not exist. */
export type ReadEntry = (path: string) => Promise<string | null>;

export interface OfficeText { text: string; truncated: boolean }

/**
 * ⛔ Says what the cut MEANS, not only that it happened. The first wording ("the file is longer")
 * made a model ask the person to "upload the complete file" — which they had done; the
 * cut is ours and a re-upload changes nothing. A count or a total over a cut table is a guess.
 */
export const TRUNCATION_NOTE = `\n\n[Truncated after ${MAX_OFFICE_TEXT_CHARS.toLocaleString('en-US')} characters by sqemes. The file itself is complete (attached, or stored in sqemes); `
  + 'this excerpt is all of it that can be read here, and attaching or uploading it again gives the same excerpt — so never ask for the file again. '
  + 'Do not count, sum or search across the whole file from it. Say plainly that the answer can only cover the rows shown (each sheet heading gives its full row count), '
  + 'and offer what is possible: an answer for the part shown, or a narrower question.]';

export async function extractOfficeText(kind: OfficeKind, name: string, read: ReadEntry): Promise<OfficeText> {
  const body = kind === 'docx' ? await docxText(read)
    : kind === 'xlsx' ? await xlsxText(read)
    : await pptxText(read);
  // ⛔ "This text is the file": with only "File: x" a model asked for the attachment it
  // was reading. It sees text, not a file, unless the text says so.
  const head = `File: ${String(name).split('/').pop()} (${KIND_LABEL[kind]}) — converted to text by sqemes ${OFFICE_READER_MARKER}; this text is the file's content.\n\n`;
  const full = head + (body.trim() || '(no text in this file)');
  if (full.length <= MAX_OFFICE_TEXT_CHARS) return { text: full, truncated: false };
  return { text: full.slice(0, MAX_OFFICE_TEXT_CHARS) + TRUNCATION_NOTE, truncated: true };
}

// ── XML helpers ─────────────────────────────────────────────────────────────

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The value of attribute `attr` in one start tag, or null. */
const attrRe = new Map<string, RegExp>();
function attrOf(tag: string, attr: string): string | null {
  // ⚡ Compiled once per attribute name: building a RegExp per call cost most of the CPU on a
  // workbook of over ten thousand rows, and an edge function has ~2 s of it (SQEM-658, measured).
  let re = attrRe.get(attr);
  if (!re) attrRe.set(attr, re = new RegExp(`\\s${attr.replace(':', '\\:')}="([^"]*)"`));
  const m = tag.match(re);
  return m ? decodeXml(m[1]) : null;
}

/**
 * The elements `<tag …>…</tag>` (or `<tag …/>`) directly in `xml`, outermost only — a nested element
 * of the same name stays inside its parent. Depth-counted, because Word nests tables in tables.
 */
function elements(xml: string, tag: string): string[] {
  return elementsAt(xml, tag).map(e => e.xml);
}

/** `elements` with each element's start position in `xml`. */
function elementsAt(xml: string, tag: string): { at: number; xml: string }[] {
  const out: { at: number; xml: string }[] = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  while (true) {
    const start = findOpen(xml, open, i);
    if (start < 0) break;
    const gt = xml.indexOf('>', start);
    if (gt < 0) break;
    if (xml[gt - 1] === '/') { out.push({ at: start, xml: xml.slice(start, gt + 1) }); i = gt + 1; continue; }
    let depth = 1;
    let j = gt + 1;
    while (depth > 0) {
      const nextOpen = findOpen(xml, open, j);
      const nextClose = xml.indexOf(close, j);
      if (nextClose < 0) { j = xml.length; break; }
      if (nextOpen >= 0 && nextOpen < nextClose) {
        const g = xml.indexOf('>', nextOpen);
        if (xml[g - 1] !== '/') depth++;
        j = g + 1;
      } else {
        depth--;
        j = nextClose + close.length;
      }
    }
    out.push({ at: start, xml: xml.slice(start, j) });
    i = j;
  }
  return out;
}

/** `<w:p` must not match `<w:pPr` — the character after the name decides. */
function findOpen(xml: string, open: string, from: number): number {
  let i = from;
  while (true) {
    const k = xml.indexOf(open, i);
    if (k < 0) return -1;
    const c = xml[k + open.length];
    if (c === '>' || c === ' ' || c === '/' || c === '\n' || c === '\r' || c === '\t') return k;
    i = k + open.length;
  }
}

/** The text of every `<tag>text</tag>` in `xml`, in order (tag is a text element like w:t or a:t). */
const textRe = new Map<string, RegExp>();
function texts(xml: string, tag: string): string[] {
  const out: string[] = [];
  let re = textRe.get(tag);
  if (!re) textRe.set(tag, re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'));
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeXml(m[1]));
  return out;
}

/** Relationship id → target path, resolved against the folder of the part the .rels belongs to. */
async function relsOf(read: ReadEntry, partPath: string): Promise<Map<string, { target: string; type: string }>> {
  const dir = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/')) : '';
  const file = partPath.slice(partPath.lastIndexOf('/') + 1);
  const xml = await read(`${dir ? dir + '/' : ''}_rels/${file}.rels`);
  const map = new Map<string, { target: string; type: string }>();
  if (!xml) return map;
  for (const rel of elements(xml, 'Relationship')) {
    const id = attrOf(rel, 'Id');
    const target = attrOf(rel, 'Target');
    if (!id || !target) continue;
    map.set(id, { target: resolvePath(dir, target), type: attrOf(rel, 'Type') ?? '' });
  }
  return map;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir ? dir.split('/') : []).concat(target.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

async function required(read: ReadEntry, path: string, kind: OfficeKind): Promise<string> {
  const xml = await read(path);
  if (xml == null) throw new OfficeReadError(`Not a valid ${KIND_LABEL[kind]}: ${path} is missing.`);
  return xml;
}

// ── Word ────────────────────────────────────────────────────────────────────

async function docxText(read: ReadEntry): Promise<string> {
  const doc = await required(read, 'word/document.xml', 'docx');
  const headingLevel = headingStyles(await read('word/styles.xml'));
  const bodyStart = doc.indexOf('<w:body');
  const body = bodyStart >= 0 ? doc.slice(bodyStart) : doc;
  // Body children in document order: tables, and the paragraphs that are not inside a table.
  // ⚡ By position, not by blanking each table out of a copy of the document (that was one full copy
  // per table — quadratic on a long document with many tables).
  const tables = elementsAt(body, 'w:tbl');
  const inTable = (at: number) => tables.some(t => at > t.at && at < t.at + t.xml.length);
  const found: { at: number; md: string }[] = tables.map(t => ({ at: t.at, md: docxTable(t.xml) }));
  for (const p of elementsAt(body, 'w:p')) {
    if (inTable(p.at)) continue;
    const md = docxParagraph(p.xml, headingLevel);
    if (md) found.push({ at: p.at, md });
  }
  found.sort((a, b) => a.at - b.at);
  return found.map(f => f.md).join('\n\n');
}

/** styleId → heading level, from the canonical (English) style names; localized ids are why. */
function headingStyles(styles: string | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!styles) return map;
  for (const s of elements(styles, 'w:style')) {
    const id = attrOf(s.slice(0, s.indexOf('>') + 1), 'w:styleId');
    const nameTag = s.match(/<w:name\s[^>]*>/)?.[0] ?? '';
    const name = (attrOf(nameTag, 'w:val') ?? '').toLowerCase();
    if (!id) continue;
    const h = name.match(/^heading (\d)$/);
    if (h) map.set(id, Number(h[1]));
    else if (name === 'title') map.set(id, 1);
  }
  return map;
}

function runText(p: string): string {
  // w:t text, w:tab as a tab, w:br / w:cr as a line break — in document order.
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out;
}

function docxParagraph(p: string, headingLevel: Map<string, number>): string {
  const text = runText(p).trim();
  if (!text) return '';
  const style = p.match(/<w:pStyle\s[^>]*w:val="([^"]*)"/)?.[1];
  const outline = p.match(/<w:outlineLvl\s[^>]*w:val="(\d)"/)?.[1];
  const level = (style && headingLevel.get(style)) || (outline != null ? Number(outline) + 1 : 0);
  if (level >= 1 && level <= 6) return `${'#'.repeat(level)} ${text}`;
  if (/<w:numPr[\s>]/.test(p)) return `- ${text}`;
  return text;
}

function docxTable(tbl: string): string {
  const rows = elements(tbl, 'w:tr').map(tr =>
    elements(tr, 'w:tc').map(tc => elements(tc, 'w:p').map(runText).map(t => t.trim()).filter(Boolean).join(' ')));
  return markdownTable(rows);
}

function markdownTable(rows: string[][]): string {
  const width = Math.max(0, ...rows.map(r => r.length));
  if (!width) return '';
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

// ── Excel ───────────────────────────────────────────────────────────────────

/** Built-in number formats that are dates or times (ECMA-376, 18.8.30). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

async function xlsxText(read: ReadEntry): Promise<string> {
  const workbook = await required(read, 'xl/workbook.xml', 'xlsx');
  const rels = await relsOf(read, 'xl/workbook.xml');
  const date1904 = /<workbookPr\s[^>]*date1904="(1|true)"/.test(workbook);
  const shared = sharedStrings(await read('xl/sharedStrings.xml'));
  const dateStyles = dateStyleIndexes(await read('xl/styles.xml'));

  const out: string[] = [];
  // ⚡ Rows are parsed only while they can still be shown; past the text cap they are only counted.
  // The cut happens in extractOfficeText anyway — parsing thousands of rows only to throw most of them away is what
  // ran out of CPU (a workbook of a few MB as a context file, "CPU Time exceeded").
  const budget = { left: MAX_OFFICE_TEXT_CHARS };
  for (const sheet of elements(workbook, 'sheet')) {
    const name = attrOf(sheet, 'name') ?? 'Sheet';
    const rid = attrOf(sheet, 'r:id');
    const target = rid ? rels.get(rid)?.target : null;
    const xml = target ? await read(target) : null;
    if (!xml) continue;
    const { lines, total } = sheetRows(xml, shared, dateStyles, date1904, budget);
    // The row count up front, so a model reading a cut excerpt still knows the real size.
    out.push(`## Sheet: ${name} (${total.toLocaleString('en-US')} rows)\n\n${lines.length ? '```csv\n' + lines.join('\n') + '\n```' : '(empty)'}`);
  }
  return out.join('\n\n');
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  // A rich-text entry is several runs; phonetic hints (<rPh>) are not part of the value.
  return elements(xml, 'si').map(si => texts(si.replace(/<rPh[\s\S]*?<\/rPh>/g, ''), 't').join(''));
}

/** Indexes into cellXfs whose number format is a date. */
function dateStyleIndexes(styles: string | null): Set<number> {
  const out = new Set<number>();
  if (!styles) return out;
  const custom = new Map<number, string>();
  for (const f of elements(styles, 'numFmt')) {
    const id = Number(attrOf(f, 'numFmtId'));
    const code = attrOf(f, 'formatCode') ?? '';
    custom.set(id, code);
  }
  const xfsBlock = elements(styles, 'cellXfs')[0] ?? '';
  elements(xfsBlock, 'xf').forEach((xf, i) => {
    const id = Number(attrOf(xf.slice(0, xf.indexOf('>') + 1), 'numFmtId') ?? 0);
    const code = custom.get(id);
    if (code != null ? isDateFormatCode(code) : DATE_FORMAT_IDS.has(id)) out.add(i);
  });
  return out;
}

/** A custom format is a date when, outside quotes and [brackets], it has day, month, year or hour parts. */
export function isDateFormatCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyh]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** An Excel serial date as ISO: a date, or a date and time when there is a time part. */
export function excelSerialToIso(serial: number, date1904 = false): string {
  const days = serial + (date1904 ? 1462 : 0);
  const ms = Math.round((days - 25569) * 86400000);
  const iso = new Date(ms).toISOString();
  return Math.abs(days - Math.round(days)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

/**
 * SQEM-660 — every sheet of a workbook as a FULL CSV (no text cap), for run_analysis in the browser.
 * Same parsing as the text above, so a count and the excerpt agree; first row = header.
 */
export async function workbookTables(read: ReadEntry): Promise<{ sheet: string; csv: string; rows: number; columns: string[] }[]> {
  const workbook = await required(read, 'xl/workbook.xml', 'xlsx');
  const rels = await relsOf(read, 'xl/workbook.xml');
  const date1904 = /<workbookPr\s[^>]*date1904="(1|true)"/.test(workbook);
  const shared = sharedStrings(await read('xl/sharedStrings.xml'));
  const dateStyles = dateStyleIndexes(await read('xl/styles.xml'));
  const out: { sheet: string; csv: string; rows: number; columns: string[] }[] = [];
  for (const sheet of elements(workbook, 'sheet')) {
    const name = attrOf(sheet, 'name') ?? 'Sheet';
    const rid = attrOf(sheet, 'r:id');
    const target = rid ? rels.get(rid)?.target : null;
    const xml = target ? await read(target) : null;
    if (!xml) continue;
    const { lines, total } = sheetRows(xml, shared, dateStyles, date1904, { left: Number.POSITIVE_INFINITY });
    if (!lines.length) continue;
    out.push({ sheet: name, csv: lines.join('\n'), rows: Math.max(0, total - 1), columns: parseCsvHeader(lines[0]) });
  }
  return out;
}

/** The header line of our own CSV (quotes doubled, commas inside quotes). */
export function parseCsvHeader(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols;
}

const ROW_RE = /<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g;
const V_RE = /<v>([\s\S]*?)<\/v>/;

/**
 * CSV lines while `budget.left` lasts, and the count of every non-empty row. One pass with
 * precompiled expressions — rows never nest, so a regex is safe here where Word needs depth counting.
 */
function sheetRows(xml: string, shared: string[], dateStyles: Set<number>, date1904: boolean, budget: { left: number }): { lines: string[]; total: number } {
  const lines: string[] = [];
  let total = 0;
  ROW_RE.lastIndex = 0;
  let row: RegExpExecArray | null;
  while ((row = ROW_RE.exec(xml))) {
    const inner = row[1];
    if (!inner || inner.indexOf('<c') < 0) continue;
    // Counted, not parsed — but only a row with a VALUE. ⛔ Excel writes formatted empty cells
    // (`<c r="A9" s="3"/>`); counting those gave half as many rows again as the sheet had.
    if (budget.left <= 0) { if (inner.indexOf('<v') >= 0 || inner.indexOf('<is') >= 0) total++; continue; }
    const cells: string[] = [];
    let next = 0;
    CELL_RE.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = CELL_RE.exec(inner))) {
      const attrs = c[1] ?? '';
      const body = c[2] ?? '';
      const ref = attrOf(attrs, 'r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const t = attrOf(attrs, 't');
      const st = Number(attrOf(attrs, 's') ?? -1);
      const vm = body ? V_RE.exec(body) : null;
      const v = vm ? decodeXml(vm[1]) : undefined;
      let value = '';
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = texts(body, 't').join('');
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'str' || t === 'e') value = v ?? '';
      else if (v != null && v !== '') {
        const n = Number(v);
        value = dateStyles.has(st) && Number.isFinite(n) ? excelSerialToIso(n, date1904) : v;
      }
      cells[col] = value;
    }
    const filled = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
    if (!filled.some(x => x !== '')) continue;
    total++;
    const line = csvLine(filled);
    lines.push(line);
    budget.left -= line.length + 1;
  }
  return { lines, total };
}

function csvLine(cells: string[]): string {
  return cells.map(c => /[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
}

// ── PowerPoint ──────────────────────────────────────────────────────────────

async function pptxText(read: ReadEntry): Promise<string> {
  const pres = await required(read, 'ppt/presentation.xml', 'pptx');
  const rels = await relsOf(read, 'ppt/presentation.xml');
  const out: string[] = [];
  let n = 0;
  for (const sld of elements(elements(pres, 'p:sldIdLst')[0] ?? '', 'p:sldId')) {
    const rid = attrOf(sld, 'r:id');
    const target = rid ? rels.get(rid)?.target : null;
    const xml = target ? await read(target) : null;
    if (!xml || !target) continue;
    n++;
    const lines = drawingParagraphs(xml);
    let notes: string[] = [];
    const slideRels = await relsOf(read, target);
    for (const r of slideRels.values()) {
      if (!r.type.endsWith('/notesSlide')) continue;
      const nx = await read(r.target);
      // Only the notes body — the notes page also carries the slide image and the slide number.
      if (nx) notes = elements(nx, 'p:sp').filter(sp => /<p:ph\s[^>]*type="body"/.test(sp)).flatMap(drawingParagraphs);
    }
    out.push(`## Slide ${n}\n\n${lines.join('\n') || '(no text)'}${notes.length ? `\n\nNotes:\n${notes.join('\n')}` : ''}`);
  }
  return out.join('\n\n');
}

function drawingParagraphs(xml: string): string[] {
  return elements(xml, 'a:p').map(p => texts(p, 'a:t').join('').trim()).filter(Boolean);
}
