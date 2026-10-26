/**
 * SQEM-597 — how a file from sqemes Chat looks: house colour, font, logo, header, footer, page size.
 *
 * Kept in TWO places, with a fixed order:
 *   1. the file's own `style` — what a skill told the model for this purpose (an agency: one brand per
 *      customer) — wins over
 *   2. the workspace default (`workspaces.document_style`, Settings → Brand, admins) — which wins over
 *   3. the plain built-in layout.
 * The default is structured on purpose: the look must not depend on a model copying values correctly
 * every time. The override is free text in a skill, turned into these fields by the model.
 *
 * ⛔ A small, closed schema. Every value is checked here — a colour is #RRGGBB, a font comes from the
 * list, texts are capped — so nothing a model writes reaches a document generator unvalidated.
 *
 * Pure: imported by chat-message (Deno) and by the browser.
 */

export const DOCUMENT_FONTS = ['Calibri', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Open Sans', 'Lato', 'Roboto'] as const;
export type DocumentFont = typeof DOCUMENT_FONTS[number];

/** The fonts a PDF can embed (pdfmake carries its own font files). Others fall back to Roboto. */
export const PDF_FONTS: readonly DocumentFont[] = ['Roboto', 'Open Sans', 'Lato'];

export const PAGE_SIZES = ['A4', 'Letter'] as const;
export type PageSize = typeof PAGE_SIZES[number];

export interface DocumentStyle {
  /** #RRGGBB, upper case. */
  primaryColor?: string;
  font?: DocumentFont;
  /** The file name of an image in the workspace's Files (png or jpg), e.g. "brand/logo.png". */
  logo?: string;
  header?: string;
  footer?: string;
  pageSize?: PageSize;
}

export const MAX_HEADER = 120;
export const MAX_FOOTER = 200;
const MAX_LOGO_NAME = 300;

/** Keeps only valid fields; null when nothing valid is left. Unknown fields are dropped, never kept. */
export function normalizeDocumentStyle(v: unknown): DocumentStyle | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: DocumentStyle = {};
  if (typeof o.primaryColor === 'string') {
    const c = o.primaryColor.trim().replace(/^#?/, '#').toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(c)) out.primaryColor = c;
  }
  if (typeof o.font === 'string') {
    const f = DOCUMENT_FONTS.find(x => x.toLowerCase() === (o.font as string).trim().toLowerCase());
    if (f) out.font = f;
  }
  if (typeof o.logo === 'string' && o.logo.trim()) out.logo = o.logo.trim().slice(0, MAX_LOGO_NAME);
  if (typeof o.header === 'string' && o.header.trim()) out.header = o.header.replace(/\s+/g, ' ').trim().slice(0, MAX_HEADER);
  if (typeof o.footer === 'string' && o.footer.trim()) out.footer = o.footer.replace(/\s+/g, ' ').trim().slice(0, MAX_FOOTER);
  if (typeof o.pageSize === 'string') {
    const p = PAGE_SIZES.find(x => x.toLowerCase() === (o.pageSize as string).trim().toLowerCase());
    if (p) out.pageSize = p;
  }
  return Object.keys(out).length ? out : null;
}

/** File style over workspace default, field by field. */
export function effectiveStyle(fileStyle?: DocumentStyle | null, workspaceStyle?: DocumentStyle | null): DocumentStyle {
  return { ...(workspaceStyle ?? {}), ...(fileStyle ?? {}) };
}

/** The tool parameter, inside the schema subset every provider accepts (no enum, no oneOf). */
export const STYLE_PARAMETER = {
  type: 'object',
  description: 'Optional. Only when a skill or the user specifies a look for this file; otherwise omit it and the workspace style applies.',
  properties: {
    primaryColor: { type: 'string', description: 'House colour as #RRGGBB.' },
    font: { type: 'string', description: `One of: ${DOCUMENT_FONTS.join(', ')}.` },
    logo: { type: 'string', description: 'File name of a png or jpg logo in the workspace files, e.g. "brand/logo.png".' },
    header: { type: 'string', description: 'One line of header text.' },
    footer: { type: 'string', description: 'One line of footer text, e.g. company and address.' },
    pageSize: { type: 'string', description: 'A4 or Letter.' },
  },
} as const;
