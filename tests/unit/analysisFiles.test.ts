import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { previewMarkdown, analysisFilesAsGenerated } from '../../lib/analysisFiles';
import { buildFile, sheetsFromMarkdown } from '../../lib/fileExport';
import { normalizeGeneratedFiles } from '../../supabase/functions/_shared/fileOutput';
import {
  analysisToolDefinition, formatAnalysisResult, storedAnalyses, normalizeStoredAnalyses, normalizeAnalyses, normalizeFileMetas,
  withAnalysisTool, EXCEL_FILE_LINE, ANALYSIS_INSTRUCTION, CONNECTOR_ANALYSIS_INSTRUCTION, MAX_ANALYSIS_FILES, type AnalysisRecord,
} from '../../supabase/functions/_shared/analysisTool';
import type { ToolRuntime } from '../../supabase/functions/_shared/libraryTools';

/**
 * SQEM-662 — an Excel file written by the analysis program (openpyxl in the isolated frame).
 *
 * The fixture is a REAL openpyxl file: written by openpyxl 3.1.5 in Pyodide 314.0.7 under Node, with the
 * files this build ships (2026-11-07) — two sheets, `=SUM(B2:B3)` in B4 without a cached value.
 */
const fixture = () => { const b = readFileSync('tests/unit/fixtures/openpyxl-review.xlsx'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

describe('the file under the answer', () => {
  it('the preview reads an openpyxl workbook: every sheet as a table', async () => {
    const md = await previewMarkdown(fixture());
    const sheets = sheetsFromMarkdown(md);
    expect(sheets.map(s => s.name)).toEqual(['Umsatz nach Jahr', 'Top-Artikel']);
    expect(sheets[0].rows[0]).toEqual(['Jahr', 'Netto', '']);
    expect(sheets[0].rows[1].slice(0, 2)).toEqual(['2024', '100.5']);
  });

  it('⛔ the download is the program\'s bytes unchanged — formulas included — never rebuilt from the preview', async () => {
    const [file] = await analysisFilesAsGenerated([{ name: 'Review.xlsx', data: fixture() }]);
    expect(file.name).toBe('Review.xlsx');
    expect(file.format).toBe('xlsx');
    const blob = await buildFile(file);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(fixture()));
  });

  it('a file the preview cannot read is still handed out', async () => {
    const junk = new TextEncoder().encode('not a zip').buffer;
    const [file] = await analysisFilesAsGenerated([{ name: 'x.xlsx', data: junk }]);
    expect(file.content).toBe('');
    expect(file.bytes).toBe(junk);
  });

  it('⛔ the bytes never travel: normalizing (what is sent and stored) drops them', async () => {
    const [file] = await analysisFilesAsGenerated([{ name: 'r.xlsx', data: fixture() }]);
    expect(normalizeGeneratedFiles([file])[0]).not.toHaveProperty('bytes');
  });
});

describe('the tool and the record', () => {
  it('both tool descriptions say how to hand out an Excel file; the instructions say not to retype one', () => {
    expect(analysisToolDefinition([{ key: 't', rows: 1, columns: ['a'] }]).description).toContain(EXCEL_FILE_LINE);
    expect(analysisToolDefinition([], { connectors: true }).description).toContain(EXCEL_FILE_LINE);
    expect(EXCEL_FILE_LINE).toContain('openpyxl to /out/<name>.xlsx');
    expect(EXCEL_FILE_LINE).toContain('also write the computed values');
    for (const t of [EXCEL_FILE_LINE, ANALYSIS_INSTRUCTION, CONNECTOR_ANALYSIS_INSTRUCTION]) expect(t).not.toMatch(/'/);
    expect(ANALYSIS_INSTRUCTION).toContain('never retyped into create_file');
  });

  it('the model hears name and size, and what was not handed out', () => {
    const out = formatAnalysisResult({ ok: true, output: 'done', files: [{ name: 'Review.xlsx', size: 5407 }], skipped: ['notes.txt'] });
    expect(out).toContain('Files handed to the person under the answer: Review.xlsx (5 KB)');
    expect(out).toContain('Not handed out (only .xlsx');
    expect(out).toContain('notes.txt');
  });

  it('live: the record carries the file metas; stored: only how many', async () => {
    const records: AnalysisRecord[] = [];
    const base = { definitions: [], stats: { calls: 0, byTool: {} }, execute: async () => '' } as unknown as ToolRuntime;
    const rt = withAnalysisTool(base, [{ key: 't', rows: 1, columns: ['a'] }], async () => ({ ok: true, output: '', files: [{ name: 'R.xlsx', size: 10 }] }), records);
    await rt.execute('run_analysis', { code: 'x' });
    expect(records[0].files).toEqual([{ name: 'R.xlsx', size: 10 }]);
    expect(storedAnalyses(records)).toEqual([{ ok: true, fileCount: 1 }]);
    expect(normalizeStoredAnalyses([{ ok: true, fileCount: 1 }, { ok: true, fileCount: 'x' }, { ok: false }])).toEqual([{ ok: true, fileCount: 1 }, { ok: true }, { ok: false }]);
    expect(normalizeAnalyses([{ code: 'x', ok: true, files: [{ name: 'R.xlsx', size: 10 }] }])[0].files).toEqual([{ name: 'R.xlsx', size: 10 }]);
    // ≤ 6 entries, ≤ 1 KB: the column's CHECK holds without a migration
    expect(JSON.stringify(storedAnalyses(Array.from({ length: 6 }, () => ({ code: 'x', ok: true, files: [{ name: 'a', size: 1 }, { name: 'b', size: 1 }, { name: 'c', size: 1 }] })))).length).toBeLessThan(1024);
  });

  it('file metas are bounded', () => {
    expect(normalizeFileMetas([{ name: 'a', size: 1 }, { name: 'b', size: 2 }, { name: 'c', size: 3 }, { name: 'd', size: 4 }, { size: 5 }])).toHaveLength(MAX_ANALYSIS_FILES);
  });
});

describe('the frame', () => {
  const html = readFileSync('public/analysis-sandbox.html', 'utf8');
  it('installs the wheels Pyodide does not know, by name, from the bytes the app handed in', () => {
    expect(html).toMatch(/const extra = Object\.keys\(files\)\.filter\(n => n\.endsWith\('\.whl'\) && !known\.has\(n\)\)\.sort\(\);/);
    expect(html).toMatch(/await py\.loadPackage\(extra\.map\(n => BASE \+ n\)/);
  });
  it('empties /out/ before every run and hands out only .xlsx files, at most 3 of 5 MB', () => {
    expect(html).toMatch(/__sh\.rmtree\(\\"\/out\\", ignore_errors=True\)/);
    expect(html).toMatch(/const MAX_FILES = 3;/);
    expect(html).toMatch(/const MAX_FILE_BYTES = 5 \* 1024 \* 1024;/);
    expect(html).toMatch(/if \(!\/\\\\\.xlsx\$\/i\.test\(name\) \|\| data\.byteLength > MAX_FILE_BYTES \|\| files\.length >= MAX_FILES\)/);
    expect(html).toMatch(/postMessage\(\{ type: 'result', id: msg\.id, ok: true, output: text, truncated: cut, files, skipped \}, files\.map\(f => f\.data\)\);/);
  });
  it('the two wheels come from PyPI with their published checksums', () => {
    const manifest = JSON.parse(readFileSync('scripts/pyodide-manifest.json', 'utf8'));
    expect(manifest.files['openpyxl-3.1.5-py2.py3-none-any.whl']).toBe('5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2');
    expect(manifest.files['et_xmlfile-2.0.0-py3-none-any.whl']).toBe('7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa');
    for (const u of Object.values(manifest.urls)) expect(String(u)).toMatch(/^https:\/\/files\.pythonhosted\.org\//);
    expect(readFileSync('scripts/fetch-pyodide.mjs', 'utf8')).toContain('manifest.urls?.[name] ?? manifest.base + name');
  });
});
