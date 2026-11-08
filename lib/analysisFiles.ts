// SQEM-662 — an Excel file an analysis program wrote (openpyxl, in the isolated frame) as a file of the
// answer: the bytes are handed out unchanged on download, formulas and formats included; the preview
// beside the chat is the sheets as tables, read back with the same reader attachments use.
//
// ⛔ Never stored (decided 2026-11-06/07): the bytes live with the answer in this tab. After a reload the
// answer only knows THAT a file was made (`files` count in `chat_messages.analyses`), and says that a
// new question makes it again.
//
// ⚠️ Formulas openpyxl writes carry no computed value — Excel computes them when the file is opened. The
// preview therefore shows a formula cell empty; the tool description asks the model to also write the
// values it computed where the person should see them.
//
// No Supabase import: tests load this without env vars.

import { workbookTables } from '../supabase/functions/_shared/officeText';
import { fileNameFor, type GeneratedFile } from '../supabase/functions/_shared/fileOutput';
import type { AnalysisFile } from './analysisSandbox';

const PREVIEW_ROWS = 200;

/** One CSV line into cells (quotes doubled, commas inside quotes) — the reader's own CSV. */
function csvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (q) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The sheets as Markdown tables under `## <sheet>` — what `sheetsFromMarkdown` shows in the preview. */
export async function previewMarkdown(data: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(new Uint8Array(data));
  const sheets = await workbookTables(async p => {
    const e = zip.file(p);
    return e ? e.async('string') : null;
  });
  return sheets.map(s => {
    const rows = csvRows(s.csv);
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => mdCell(r[i] ?? ''));
    const [head, ...body] = rows;
    const shown = body.slice(0, PREVIEW_ROWS);
    return [`## ${s.sheet}`, '', `| ${pad(head).join(' | ')} |`, `|${' --- |'.repeat(width)}`,
      ...shown.map(r => `| ${pad(r).join(' | ')} |`),
      ...(body.length > shown.length ? ['', `… ${body.length - shown.length} more rows in the file`] : [])].join('\n');
  }).filter(Boolean).join('\n\n');
}

/** The program's files as files of the answer. A file the preview cannot read is still handed out. */
export async function analysisFilesAsGenerated(files: AnalysisFile[]): Promise<GeneratedFile[]> {
  return Promise.all(files.map(async f => {
    let content = '';
    try { content = await previewMarkdown(f.data); } catch { /* the download is the file itself */ }
    return { name: fileNameFor(f.name.replace(/\.xlsx$/i, ''), 'xlsx'), format: 'xlsx' as const, content, bytes: f.data };
  }));
}
