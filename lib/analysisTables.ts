// SQEM-660 — the tables a chat attachment offers to run_analysis: every sheet of an .xlsx (full,
// not the text excerpt) and a .csv as it is. Built in the browser when the file is attached and kept
// with the attachment in memory — the server only ever sees each table's key, row count and columns
// (`analysisTableMeta`), never a row.
//
// No Supabase import: tests load this without env vars.

import { workbookTables, parseCsvHeader } from '../supabase/functions/_shared/officeText';
import type { AnalysisTable } from './analysisSandbox';

export interface AttachmentTable extends AnalysisTable {
  rows: number;
  columns: string[];
}

export function isTableFile(name: string, mimeType = ''): boolean {
  return /\.(xlsx|csv)$/i.test(name) || mimeType === 'text/csv';
}

export async function tablesFromFile(blob: Blob, name: string): Promise<AttachmentTable[]> {
  const base = String(name).split('/').pop() || name;
  if (/\.xlsx$/i.test(base)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sheets = await workbookTables(async p => {
      const e = zip.file(p);
      return e ? e.async('string') : null;
    });
    return sheets.map(s => ({ key: sheets.length === 1 ? base : `${base} / ${s.sheet}`, csv: s.csv, rows: s.rows, columns: s.columns }));
  }
  const csv = await blob.text();
  const lines = csv.split(/\r?\n/).filter(l => l.length > 0);
  return lines.length ? [{ key: base, csv, rows: lines.length - 1, columns: parseCsvHeader(lines[0]) }] : [];
}

/** What the request carries: never the rows. Keys are unique (a second file of the same name gets a suffix). */
export function analysisTableMeta(tables: AttachmentTable[]): { key: string; rows: number; columns: string[] }[] {
  return tables.map(t => ({ key: t.key, rows: t.rows, columns: t.columns }));
}

/** Merges the tables of several attachments, making keys unique in order of appearance. */
export function uniqueTables(groups: AttachmentTable[][]): AttachmentTable[] {
  const seen = new Map<string, number>();
  const out: AttachmentTable[] = [];
  for (const t of groups.flat()) {
    const n = (seen.get(t.key) ?? 0) + 1;
    seen.set(t.key, n);
    out.push(n === 1 ? t : { ...t, key: `${t.key} (${n})` });
  }
  return out;
}
