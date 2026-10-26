/**
 * SQEM-595 — sqemes Chat hands an answer out as a FILE: Markdown, text, Word, PDF or Excel.
 *
 * ⭐ **The server never builds the file.** The model calls `create_file(name, format, content)`; this
 * module checks the request and records a description `{name, format, content}`. The description rides
 * on the result broadcast like `webSources` (SQEM-594), the client stores it with the answer
 * (`chat_messages.generated_files`) and builds the actual .docx/.pdf/.xlsx **in the browser, on click**
 * (`lib/fileExport.ts`). No bucket, no storage cost, nothing to clean up, and self-host behaves the same.
 *
 * ⛔ **Download only**: no "save to Files", no result store — "saved results" is a
 * removed concept (VISION → Guardrails). The file lives in the conversation, like the answer text.
 *
 * ⭐ **`content` is always Markdown**, for every format. One flat schema every provider accepts (Gemini
 * included), and the same text drives the preview and the file. For xlsx every Markdown table becomes a
 * sheet, named after the heading above it — `sheetsFromMarkdown()` in `lib/fileExport.ts`.
 *
 * Pure: imported by chat-message (Deno) and by the browser.
 */
import type { ToolDefinition, ToolRuntime } from './libraryTools.ts';
import { normalizeDocumentStyle, STYLE_PARAMETER, type DocumentStyle } from './documentStyle.ts';

export const FILE_FORMATS = ['md', 'txt', 'docx', 'pdf', 'xlsx', 'pptx'] as const; // pptx: SQEM-596
export type FileFormat = typeof FILE_FORMATS[number];

export interface GeneratedFile {
  name: string;
  format: FileFormat;
  content: string;
  /** SQEM-597 — the look a skill asked for; over the workspace default. Validated, never raw. */
  style?: DocumentStyle;
}

export const MAX_FILE_CHARS = 200_000;
export const MAX_FILES_PER_ANSWER = 5;
const MAX_NAME = 120;

export const FILE_LABELS: Record<FileFormat, string> = {
  md: 'Markdown', txt: 'Text', docx: 'Word', pdf: 'PDF', xlsx: 'Excel', pptx: 'PowerPoint',
};

/** `Angebot: Müller/2026?` + docx → `Angebot Müller 2026.docx`. Letters of every script survive. */
export function fileNameFor(raw: string, format: FileFormat): string {
  const base = String(raw ?? '')
    .replace(/\.(md|markdown|txt|docx?|pdf|xlsx?|csv|pptx?)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, MAX_NAME)
    .trim() || 'document';
  return `${base}.${format}`;
}

/** Has the Markdown at least one table (GFM pipe table: a header row and a delimiter row)? */
export function hasMarkdownTable(md: string): boolean {
  return /^\s*\|?.*\|.*\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/m.test(md);
}

/** SQEM-596 — a slide needs a title: at least one `#` or `##` heading. */
export function hasSlideHeading(md: string): boolean {
  return /^#{1,2}\s+\S/m.test(md);
}

/** Check one create_file call. The error text goes back to the model, so it says what to fix. */
export function validateFileRequest(args: Record<string, unknown>): { file: GeneratedFile } | { error: string } {
  const format = String(args?.format ?? '').toLowerCase().replace(/^\./, '') as FileFormat;
  if (!FILE_FORMATS.includes(format)) return { error: `format must be one of: ${FILE_FORMATS.join(', ')}.` };
  const content = typeof args?.content === 'string' ? args.content : '';
  if (!content.trim()) return { error: 'content is empty. Put the whole document into content, as Markdown.' };
  if (content.length > MAX_FILE_CHARS) return { error: `content is too long (${content.length} characters, at most ${MAX_FILE_CHARS}). Shorten it or split it into several files.` };
  if (format === 'xlsx' && !hasMarkdownTable(content)) {
    return { error: 'For xlsx, content must contain at least one Markdown table (header row, then a |---| row). Each table becomes one sheet; the heading above a table names the sheet.' };
  }
  if (format === 'pptx' && !hasSlideHeading(content)) {
    return { error: 'For pptx, start every slide with a "## " heading (its title). An optional "# " heading with a line under it becomes the title slide. Under a heading use short bullet points or one table.' };
  }
  const style = normalizeDocumentStyle(args?.style); // SQEM-597 — invalid fields are dropped, not refused
  return { file: { name: fileNameFor(String(args?.name ?? ''), format), format, content, ...(style ? { style } : {}) } };
}

export const CREATE_FILE_DEFINITION: ToolDefinition = {
  name: 'create_file',
  description: 'Hand the user a downloadable file: md, txt, docx (Word), pdf, xlsx (Excel) or pptx (PowerPoint). Use it when the user asks for a document, a file, a download, a presentation or slides (pptx), a spreadsheet or table file (xlsx), or one of these formats. Write the COMPLETE document into content as Markdown (headings, lists, tables, bold). For xlsx, put the data in Markdown tables; each table becomes one sheet, named after the heading above it. For pptx, put ALL slides into ONE file with ONE create_file call — never one file per slide. In it, an optional "# " heading with one line under it IS the title slide (do not add another title slide); every "## " heading starts a slide and its text is the slide title (no numbering like "Slide 2:"), with a few short bullet points or one table under it. If a skill or the user describes how documents should look (colour, font, logo, header, footer), pass it in style; otherwise leave style out. The user sees the file as a card under your answer with a preview, so do not repeat its whole content in your answer; one or two sentences about it are enough.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'File name without extension, e.g. "Angebot Müller GmbH".' },
      format: { type: 'string', description: 'One of: md, txt, docx, pdf, xlsx, pptx.' },
      content: { type: 'string', description: 'The whole document as Markdown.' },
      style: STYLE_PARAMETER, // SQEM-597
    },
    required: ['name', 'format', 'content'],
  },
};

/**
 * Adds `create_file` to a runtime. Every accepted file is pushed to `files`; a refusal becomes the
 * tool's answer so the model can correct itself.
 */
export function withFileTool(runtime: ToolRuntime, files: GeneratedFile[]): ToolRuntime {
  return {
    ...runtime,
    definitions: [...runtime.definitions, CREATE_FILE_DEFINITION],
    stats: runtime.stats,
    async execute(name, args) {
      if (name !== 'create_file') return runtime.execute(name, args);
      runtime.stats.calls += 1;
      runtime.stats.byTool[name] = (runtime.stats.byTool[name] ?? 0) + 1;
      if (files.length >= MAX_FILES_PER_ANSWER) return `At most ${MAX_FILES_PER_ANSWER} files per answer. Combine the rest into one file.`;
      const checked = validateFileRequest(args);
      if ('error' in checked) return `create_file refused: ${checked.error}`;
      files.push(checked.file);
      // SQEM-595 — seen in testing: the model wrote a made-up sqemes://files/… link to the file. The card is
      // the only way to it; say so.
      return `File created: ${checked.file.name} (${FILE_LABELS[checked.file.format]}). The user sees it as a card under your answer, with a preview and a download button. Do not write a link or URL to it — there is none; refer to it by its name.`;
    },
  };
}

/** Shape-check for what the client stores and replays. Anything else is dropped. */
export function normalizeGeneratedFiles(v: unknown): GeneratedFile[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is GeneratedFile => !!f && typeof f === 'object'
      && FILE_FORMATS.includes((f as GeneratedFile).format)
      && typeof (f as GeneratedFile).name === 'string'
      && typeof (f as GeneratedFile).content === 'string')
    .slice(0, MAX_FILES_PER_ANSWER)
    .map(f => {
      const style = normalizeDocumentStyle(f.style);
      return { name: fileNameFor(f.name, f.format), format: f.format, content: f.content.slice(0, MAX_FILE_CHARS), ...(style ? { style } : {}) };
    });
}
