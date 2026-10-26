/**
 * SQEM-595 — builds the file a Chat answer handed out, in the browser, from its Markdown.
 *
 * The server only records `{name, format, content}` (`supabase/functions/_shared/fileOutput.ts`); the
 * actual .docx/.pdf/.xlsx is made here when someone downloads it, so nothing is stored anywhere.
 *
 * ⭐ One parse, three writers: the Markdown becomes an mdast tree (the same parser family react-markdown
 * uses, with GFM for tables), and each writer walks that tree. The heavy libraries — `docx`, `pdfmake`
 * (with its Roboto fonts, ~1 MB), `write-excel-file` — are imported dynamically, so they load on the first
 * download of that format and never with the Chat page.
 *
 * The pure parts (`parseMarkdown`, `inlineText`, `sheetsFromMarkdown`, `plainTextFromMarkdown`,
 * `pdfDefinition`) are exported for tests/unit/fileExport.test.ts.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Root, RootContent, PhrasingContent, Table, List } from 'mdast';
import type { GeneratedFile, FileFormat } from '../supabase/functions/_shared/fileOutput.ts';
import { PDF_FONTS, type DocumentStyle } from '../supabase/functions/_shared/documentStyle.ts';

/**
 * SQEM-597 — a logo ready for every writer: the bytes (docx), a data URL (pdf, pptx) and its pixel size,
 * so each writer can scale it to its own header height without distorting it.
 */
export interface LogoImage {
  data: Uint8Array; type: 'png' | 'jpg'; dataUrl: string; width: number; height: number;
  /**
   * The logo flattened onto white as a JPEG — what the PDF uses. ⛔ pdfmake splits a PNG's alpha channel
   * in a Web Worker started from a `blob:` URL, and our CSP has no `worker-src` (so `script-src 'self'`
   * applies): every PDF with a transparent logo failed. Found building a sample with the real logo.
   * Without this the PDF leaves the logo out rather than fail.
   */
  pdfDataUrl?: string;
}

/** SQEM-597 — the variants of an embeddable PDF font, as base64 file contents. */
export type PdfFontFiles = { normal: string; bold: string; italics: string; bolditalics: string };

export interface BuildOptions {
  /** The EFFECTIVE style (file style over workspace default — `effectiveStyle()`). */
  style?: DocumentStyle;
  logo?: LogoImage | null;
  /** Loads an embeddable font; the default fetches the bundled WOFF files. Injected by tests. */
  pdfFontFiles?: (font: 'Open Sans' | 'Lato') => Promise<PdfFontFiles>;
}

/** "#0A5C8F" → "0A5C8F" (what docx and pptxgenjs want). */
const hex = (c?: string) => c?.replace(/^#/, '');
/** Scale to a target height, never wider than maxW. */
function fitLogo(logo: LogoImage, h: number, maxW: number): { w: number; h: number } {
  const ratio = logo.width / Math.max(1, logo.height);
  const w = Math.min(maxW, h * ratio);
  return { w, h: w / ratio };
}

export const MIME: Record<FileFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function parseMarkdown(md: string): Root {
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** The visible text of inline content: emphasis and links unwrapped, line breaks kept. */
export function inlineText(nodes: PhrasingContent[] | undefined): string {
  return (nodes ?? []).map(n => {
    if (n.type === 'text' || n.type === 'inlineCode') return n.value;
    if (n.type === 'break') return '\n';
    if ('children' in n) return inlineText(n.children as PhrasingContent[]);
    return '';
  }).join('');
}

function blockText(node: RootContent): string {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
      return inlineText(node.children);
    case 'code':
      return node.value;
    case 'blockquote':
      return node.children.map(blockText).join('\n');
    case 'list':
      return node.children.map((item, i) => `${node.ordered ? `${(node.start ?? 1) + i}.` : '-'} ${item.children.map(blockText).join('\n')}`).join('\n');
    case 'table':
      return node.children.map(row => row.children.map(c => inlineText(c.children)).join('\t')).join('\n');
    case 'thematicBreak':
      return '';
    default:
      return 'children' in node ? (node.children as RootContent[]).map(blockText).join('\n') : ('value' in node ? String(node.value) : '');
  }
}

/** For .txt: the document without Markdown syntax, blocks separated by a blank line. */
export function plainTextFromMarkdown(md: string): string {
  return parseMarkdown(md).children.map(blockText).filter(Boolean).join('\n\n') + '\n';
}

export interface SheetSpec { name: string; rows: string[][] }

function tableRows(t: Table): string[][] {
  return t.children.map(row => row.children.map(c => inlineText(c.children).trim()));
}

/** Excel forbids these in sheet names and allows 31 characters; names must be unique. */
function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

/** Every Markdown table becomes one sheet, named after the closest heading above it. */
export function sheetsFromMarkdown(md: string): SheetSpec[] {
  const used = new Set<string>();
  const sheets: SheetSpec[] = [];
  let heading = '';
  for (const node of parseMarkdown(md).children) {
    if (node.type === 'heading') heading = inlineText(node.children);
    if (node.type === 'table') {
      sheets.push({ name: sheetName(heading || `Sheet ${sheets.length + 1}`, used), rows: tableRows(node) });
      heading = '';
    }
  }
  return sheets;
}

/** "1.234,50" / "1234.5" / "-3" → a number, so Excel can sum it; anything else stays text. */
export function cellValue(text: string): string | number {
  const t = text.replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return Number(t);
  return text;
}

// ── Slides (SQEM-596 — pure, shared by the pptx writer and the preview) ─────────────────────────

export interface SlideSpec {
  /** The opening slide: a `#` heading with an optional line under it. */
  isTitle: boolean;
  title: string;
  subtitle?: string;
  bullets: { text: string; level: number }[];
  table?: string[][];
}

/** More bullets than this and the slide continues on a "(cont.)" slide — text walls do not fit 16:9. */
export const MAX_BULLETS_PER_SLIDE = 8;

/**
 * `##` starts a slide (its title); a `#` before any slide is the title slide, its first paragraph the
 * subtitle; `---` closes a slide. Lists and paragraphs become bullets, a table stays a table.
 */
export function slidesFromMarkdown(md: string): SlideSpec[] {
  const raw: SlideSpec[] = [];
  let cur: SlideSpec | null = null;
  const open = (title: string, isTitle = false) => { cur = { isTitle, title, bullets: [] }; raw.push(cur); return cur; };
  const ensure = () => cur ?? open('');
  const addList = (list: List, level: number) => {
    for (const item of list.children) {
      for (const child of item.children) {
        if (child.type === 'list') addList(child, level + 1);
        else { const t = blockText(child).trim(); if (t) ensure().bullets.push({ text: t, level }); }
      }
    }
  };
  for (const node of parseMarkdown(md).children) {
    if (node.type === 'heading' && node.depth === 1 && raw.length === 0) { open(inlineText(node.children), true); continue; }
    if (node.type === 'heading' && node.depth <= 2) { open(inlineText(node.children)); continue; }
    if (node.type === 'thematicBreak') { cur = null; continue; }
    const s = ensure();
    if (node.type === 'paragraph' && s.isTitle && !s.subtitle && !s.bullets.length) { s.subtitle = inlineText(node.children); continue; }
    if (node.type === 'list') { addList(node, 0); continue; }
    if (node.type === 'table') {
      if (s.table) { open(`${s.title} (cont.)`).table = tableRows(node); continue; }
      s.table = tableRows(node);
      continue;
    }
    const t = (node.type === 'heading' ? inlineText(node.children) : blockText(node)).trim();
    if (t) s.bullets.push({ text: t, level: 0 });
  }
  // Split long slides; a title slide never carries bullets of its own.
  const out: SlideSpec[] = [];
  for (const s of raw) {
    if (s.isTitle && s.bullets.length) {
      out.push({ ...s, bullets: [] });
      out.push({ isTitle: false, title: s.title, bullets: s.bullets, table: s.table });
      continue;
    }
    if (s.bullets.length <= MAX_BULLETS_PER_SLIDE) { out.push(s); continue; }
    for (let i = 0; i < s.bullets.length; i += MAX_BULLETS_PER_SLIDE) {
      out.push({
        isTitle: false,
        title: i === 0 ? s.title : `${s.title} (cont.)`,
        bullets: s.bullets.slice(i, i + MAX_BULLETS_PER_SLIDE),
        table: i + MAX_BULLETS_PER_SLIDE >= s.bullets.length ? s.table : undefined,
      });
    }
  }
  return out.filter(s => s.title || s.subtitle || s.bullets.length || s.table);
}

// ── PDF (pdfmake document definition — pure, so it can be tested without rendering) ─────────────

type PdfNode = Record<string, unknown> | string;

function pdfInline(nodes: PhrasingContent[] | undefined, style: Record<string, unknown> = {}): PdfNode[] {
  return (nodes ?? []).flatMap((n): PdfNode[] => {
    if (n.type === 'text') return [{ text: n.value, ...style }];
    if (n.type === 'inlineCode') return [{ text: n.value, background: '#f1f1f1', ...style }];
    if (n.type === 'break') return [{ text: '\n' }];
    if (n.type === 'strong') return pdfInline(n.children, { ...style, bold: true });
    if (n.type === 'emphasis') return pdfInline(n.children, { ...style, italics: true });
    if (n.type === 'delete') return pdfInline(n.children, { ...style, decoration: 'lineThrough' });
    if (n.type === 'link') return pdfInline(n.children, { ...style, link: n.url, color: '#1a56db', decoration: 'underline' });
    if ('children' in n) return pdfInline(n.children as PhrasingContent[], style);
    return [];
  });
}

function pdfList(list: List): PdfNode {
  const items = list.children.map(item => ({ stack: item.children.map(pdfBlock) }));
  return list.ordered ? { ol: items, start: list.start ?? 1, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] };
}

function pdfBlock(node: RootContent): PdfNode {
  switch (node.type) {
    case 'heading': return { text: pdfInline(node.children), style: `h${Math.min(node.depth, 4)}` };
    case 'paragraph': return { text: pdfInline(node.children), margin: [0, 0, 0, 8] };
    case 'list': return pdfList(node);
    case 'blockquote': return { stack: node.children.map(pdfBlock), italics: true, margin: [16, 0, 0, 8], color: '#555555' };
    case 'code': return { text: node.value, background: '#f1f1f1', fontSize: 9, margin: [0, 0, 0, 8], preserveLeadingSpaces: true };
    case 'thematicBreak': return { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 0.5, lineColor: '#cccccc' }], margin: [0, 4, 0, 12] };
    case 'table': {
      const body = node.children.map((row, r) => row.children.map(c => ({ text: pdfInline(c.children), bold: r === 0 })));
      const cols = Math.max(...body.map(r => r.length));
      return { table: { headerRows: 1, widths: Array(cols).fill('*'), body: body.map(r => [...r, ...Array(cols - r.length).fill('')]) }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 10] };
    }
    default: return { text: blockText(node), margin: [0, 0, 0, 8] };
  }
}

/** The font a PDF can actually use: the chosen one if it is embeddable, else Roboto. */
export function pdfFontFor(style: DocumentStyle = {}): 'Roboto' | 'Open Sans' | 'Lato' {
  return (style.font && PDF_FONTS.includes(style.font) ? style.font : 'Roboto') as 'Roboto' | 'Open Sans' | 'Lato';
}

export function pdfDefinition(md: string, title: string, style: DocumentStyle = {}, logo: LogoImage | null = null): Record<string, unknown> {
  const color = style.primaryColor;
  const content = parseMarkdown(md).children.map(pdfBlock) as Record<string, unknown>[];
  // SQEM-597 — the table header in the house colour, white text.
  if (color) {
    for (const node of content) {
      const t = node.table as { body?: Record<string, unknown>[][] } | undefined;
      if (t?.body?.[0]) t.body[0] = t.body[0].map(cell => ({ ...cell, fillColor: color, color: '#FFFFFF' }));
    }
  }
  const hasHeader = !!(logo?.pdfDataUrl || style.header);
  // SQEM-597 — only the flattened JPEG reaches pdfmake (see LogoImage.pdfDataUrl).
  const pdfLogo = logo?.pdfDataUrl ? logo : null;
  const logoFit = pdfLogo ? fitLogo(pdfLogo, 28, 140) : null;
  return {
    info: { title },
    pageSize: style.pageSize === 'Letter' ? 'LETTER' : 'A4',
    pageMargins: [56, hasHeader ? 76 : 56, 56, style.footer ? 64 : 56],
    ...(hasHeader ? {
      header: () => ({
        margin: [56, 24, 56, 0],
        columns: [
          pdfLogo ? { image: pdfLogo.pdfDataUrl, width: logoFit!.w, height: logoFit!.h } : { text: '' },
          { text: style.header ?? '', alignment: 'right', fontSize: 8.5, color: '#6B7280', margin: [0, 8, 0, 0] },
        ],
      }),
    } : {}),
    ...(style.footer ? {
      footer: (page: number, pages: number) => ({
        margin: [56, 24, 56, 0],
        columns: [
          { text: style.footer, fontSize: 8, color: '#6B7280' },
          { text: `${page} / ${pages}`, alignment: 'right', fontSize: 8, color: '#6B7280', width: 40 },
        ],
      }),
    } : {}),
    content,
    defaultStyle: { fontSize: 10.5, lineHeight: 1.25, font: pdfFontFor(style) },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 4, 0, 10], ...(color ? { color } : {}) },
      h2: { fontSize: 15, bold: true, margin: [0, 10, 0, 6], ...(color ? { color } : {}) },
      h3: { fontSize: 12.5, bold: true, margin: [0, 8, 0, 4], ...(color ? { color } : {}) },
      h4: { fontSize: 11, bold: true, margin: [0, 6, 0, 4], ...(color ? { color } : {}) },
    },
  };
}

// ── Builders (dynamic imports) ──────────────────────────────────────────────────────────────────

async function docxBlob(md: string, title: string, style: DocumentStyle = {}, logo: LogoImage | null = null): Promise<Blob> {
  const color = hex(style.primaryColor);
  const d = await import('docx');
  const runs = (nodes: PhrasingContent[] | undefined, style: { bold?: boolean; italics?: boolean; strike?: boolean } = {}): (InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink>)[] =>
    (nodes ?? []).flatMap((n): (InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink>)[] => {
      if (n.type === 'text') return [new d.TextRun({ text: n.value, ...style })];
      if (n.type === 'inlineCode') return [new d.TextRun({ text: n.value, font: 'Consolas', ...style })];
      if (n.type === 'break') return [new d.TextRun({ break: 1 })];
      if (n.type === 'strong') return runs(n.children, { ...style, bold: true });
      if (n.type === 'emphasis') return runs(n.children, { ...style, italics: true });
      if (n.type === 'delete') return runs(n.children, { ...style, strike: true });
      if (n.type === 'link') return [new d.ExternalHyperlink({ link: n.url, children: [new d.TextRun({ text: inlineText(n.children), style: 'Hyperlink', ...style })] })];
      if ('children' in n) return runs(n.children as PhrasingContent[], style);
      return [];
    });
  const HEADINGS = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  const blocks = (node: RootContent, level = 0): (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] => {
    switch (node.type) {
      case 'heading': return [new d.Paragraph({ heading: HEADINGS[node.depth - 1], children: runs(node.children) })];
      case 'paragraph': return [new d.Paragraph({ children: runs(node.children), spacing: { after: 120 } })];
      case 'list': return node.children.flatMap((item, i) => item.children.flatMap((child, j) => {
        if (child.type === 'paragraph' && j === 0) {
          return [node.ordered
            ? new d.Paragraph({ children: [new d.TextRun(`${(node.start ?? 1) + i}. `), ...runs(child.children)], indent: { left: 360 * (level + 1), hanging: 360 } })
            : new d.Paragraph({ children: runs(child.children), bullet: { level } })];
        }
        return child.type === 'list' ? blocks(child, level + 1) : blocks(child, level);
      }));
      case 'blockquote': return node.children.flatMap(c => blocks(c, level)).map(p => p);
      case 'code': return node.value.split('\n').map(line => new d.Paragraph({ children: [new d.TextRun({ text: line, font: 'Consolas', size: 18 })] }));
      case 'thematicBreak': return [new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } } })];
      case 'table': return [new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        rows: node.children.map((row, r) => new d.TableRow({
          tableHeader: r === 0,
          children: row.children.map(c => new d.TableCell({
            // SQEM-597 — header row in the house colour, white text.
            ...(r === 0 && color ? { shading: { fill: color, type: d.ShadingType.CLEAR, color: 'auto' } } : {}),
            children: [new d.Paragraph({ children: r === 0 && color ? [new d.TextRun({ text: inlineText(c.children), bold: true, color: 'FFFFFF' })] : runs(c.children, r === 0 ? { bold: true } : {}) })],
          })),
        })),
      }), new d.Paragraph({})];
      default: return [new d.Paragraph(blockText(node))];
    }
  };
  const font = style.font ?? 'Calibri';
  const headingRun = { font, ...(color ? { color } : {}) };
  const logoFit = logo ? fitLogo(logo, 36, 180) : null;
  const header = (logo || style.header) ? new d.Header({ children: [new d.Paragraph({
    children: [
      ...(logo ? [new d.ImageRun({ type: logo.type, data: logo.data, transformation: { width: Math.round(logoFit!.w), height: Math.round(logoFit!.h) } })] : []),
      ...(style.header ? [new d.TextRun({ text: `${logo ? '    ' : ''}${style.header}`, size: 16, color: '6B7280', font })] : []),
    ],
  })] }) : undefined;
  const footer = style.footer ? new d.Footer({ children: [new d.Paragraph({
    alignment: d.AlignmentType.CENTER,
    children: [new d.TextRun({ text: style.footer, size: 16, color: '6B7280', font })],
  })] }) : undefined;
  const doc = new d.Document({
    title,
    styles: { default: {
      document: { run: { font, size: 22 } },
      heading1: { run: headingRun }, heading2: { run: headingRun }, heading3: { run: headingRun }, heading4: { run: headingRun },
    } },
    sections: [{
      properties: { page: { size: style.pageSize === 'Letter' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 } } },
      ...(header ? { headers: { default: header } } : {}),
      ...(footer ? { footers: { default: footer } } : {}),
      children: parseMarkdown(md).children.flatMap(n => blocks(n)),
    }],
  });
  return new Blob([await d.Packer.toArrayBuffer(doc)], { type: MIME.docx });
}

/** The bundled WOFF files of the two extra PDF fonts (OFL-1.1), fetched only when a PDF uses them. */
async function bundledPdfFont(font: 'Open Sans' | 'Lato'): Promise<PdfFontFiles> {
  const urls = (await import('./pdfFonts')).PDF_FONT_URLS[font];
  const b64 = async (u: string) => {
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const [normal, bold, italics, bolditalics] = await Promise.all([urls.normal, urls.bold, urls.italics, urls.bolditalics].map(b64));
  return { normal, bold, italics, bolditalics };
}

async function pdfBlob(md: string, title: string, style: DocumentStyle = {}, logo: LogoImage | null = null, loadFont: BuildOptions['pdfFontFiles'] = bundledPdfFont): Promise<Blob> {
  const [{ default: pdfMake }, vfs] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const maker = pdfMake as unknown as { addVirtualFileSystem(v: unknown): void; addFonts(f: unknown): void; createPdf(def: unknown): { getBlob(): Promise<Blob> } };
  maker.addVirtualFileSystem((vfs as { default?: unknown }).default ?? vfs);
  // SQEM-597 — an embeddable font other than Roboto is loaded and registered for this document only.
  const font = pdfFontFor(style);
  if (font !== 'Roboto') {
    const files = await loadFont(font);
    const key = font.replace(/\s/g, '');
    maker.addVirtualFileSystem({ [`${key}-r.woff`]: files.normal, [`${key}-b.woff`]: files.bold, [`${key}-i.woff`]: files.italics, [`${key}-bi.woff`]: files.bolditalics });
    maker.addFonts({ [font]: { normal: `${key}-r.woff`, bold: `${key}-b.woff`, italics: `${key}-i.woff`, bolditalics: `${key}-bi.woff` } });
  }
  return maker.createPdf(pdfDefinition(md, title, style, logo)).getBlob();
}

async function pptxBlob(md: string, title: string, style: DocumentStyle = {}, logo: LogoImage | null = null): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in, 16:9
  pres.title = title;
  const W = 13.33, X = 0.6, CW = W - 2 * X;
  // SQEM-597 — font, house colour for titles and the table header, logo top right, footer line.
  const face = style.font ?? 'Calibri';
  const titleColor = hex(style.primaryColor) ?? '1F2937';
  const logoFit = logo ? fitLogo(logo, 0.5, 2.2) : null;
  for (const s of slidesFromMarkdown(md)) {
    const slide = pres.addSlide();
    if (logo) slide.addImage({ data: logo.dataUrl, x: W - X - logoFit!.w, y: 0.3, w: logoFit!.w, h: logoFit!.h });
    if (style.footer) slide.addText(style.footer, { x: X, y: 7.0, w: CW - 1, h: 0.3, fontSize: 10, fontFace: face, color: '6B7280' });
    if (s.isTitle) {
      slide.addText(s.title, { x: X, y: 2.4, w: CW, h: 1.4, fontSize: 40, bold: true, align: 'center', fontFace: face, color: titleColor });
      if (s.subtitle) slide.addText(s.subtitle, { x: X, y: 3.9, w: CW, h: 0.9, fontSize: 20, align: 'center', fontFace: face, color: '4B5563' });
      continue;
    }
    if (s.title) slide.addText(s.title, { x: X, y: 0.35, w: logo ? CW - logoFit!.w - 0.2 : CW, h: 0.9, fontSize: 28, bold: true, fontFace: face, color: titleColor });
    let y = 1.4;
    if (s.bullets.length) {
      const h = s.table ? Math.min(2.2, 0.45 * s.bullets.length + 0.2) : 5.6;
      slide.addText(
        s.bullets.map(b => ({ text: b.text, options: { bullet: true, indentLevel: b.level, breakLine: true } })),
        { x: X, y, w: CW, h, fontSize: s.table ? 16 : 20, fontFace: face, color: '1F2937', valign: 'top', paraSpaceAfter: 6 },
      );
      y += h + 0.2;
    }
    if (s.table) {
      const cols = Math.max(...s.table.map(r => r.length));
      slide.addTable(
        s.table.map((row, r) => Array.from({ length: cols }, (_, c) => ({
          text: row[c] ?? '',
          options: r === 0 ? { bold: true, fill: { color: hex(style.primaryColor) ?? 'F3F4F6' }, ...(style.primaryColor ? { color: 'FFFFFF' } : {}) } : {},
        }))),
        { x: X, y, w: CW, fontSize: 14, fontFace: face, color: '1F2937', border: { type: 'solid', pt: 0.5, color: 'D1D5DB' }, autoPage: true },
      );
    }
  }
  return new Blob([await pres.write({ outputType: 'arraybuffer' }) as ArrayBuffer], { type: MIME.pptx });
}

async function xlsxBlob(md: string, style: DocumentStyle = {}): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = sheetsFromMarkdown(md).map(s => ({
    sheet: s.name,
    // SQEM-597 — header row in the house colour; the font on every cell (Excel shows it if installed).
    data: s.rows.map((row, r) => row.map(text => ({
      ...(r === 0 ? { value: text, fontWeight: 'bold' as const } : { value: cellValue(text) }),
      ...(style.font ? { fontFamily: style.font } : {}),
      ...(r === 0 && style.primaryColor ? { backgroundColor: style.primaryColor, textColor: '#FFFFFF' } : {}),
    }))),
  }));
  // ⚠️ v4 returns `{ toBlob, toFile }`, not a Blob — a cast here hid that once and every xlsx failed
  // (found building a real file; pinned in tests/unit/fileOutput.test.ts).
  return (writeXlsxFile(sheets as never) as unknown as { toBlob(): Promise<Blob> }).toBlob();
}

/** Build the file. Throws with a readable message; the caller shows it. */
export async function buildFile(file: GeneratedFile, opts: BuildOptions = {}): Promise<Blob> {
  const title = file.name.replace(/\.[a-z]+$/, '');
  const style = opts.style ?? file.style ?? {};
  const logo = opts.logo ?? null;
  switch (file.format) {
    case 'md': return new Blob([file.content], { type: MIME.md });
    case 'txt': return new Blob([plainTextFromMarkdown(file.content)], { type: MIME.txt });
    case 'docx': return docxBlob(file.content, title, style, logo);
    case 'pdf': return pdfBlob(file.content, title, style, logo, opts.pdfFontFiles);
    case 'xlsx': return xlsxBlob(file.content, style);
    case 'pptx': return pptxBlob(file.content, title, style, logo);
  }
}

export async function downloadGeneratedFile(file: GeneratedFile, opts: BuildOptions = {}): Promise<void> {
  const blob = await buildFile(file, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
