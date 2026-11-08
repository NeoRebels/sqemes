/**
 * SQEM-660 — `run_analysis`: the model writes a Python program, the PERSON'S BROWSER runs it on their
 * attached tables (lib/analysisSandbox.ts, an isolated frame), the result comes back as the tool's
 * answer. Counting, summing and filtering across thousands of rows is computation; a model reading a
 * text excerpt guesses (measured on a stock list of over ten thousand rows).
 *
 * ⛔ The data never comes here. The request carries only each table's key, row count and column
 * names (`AnalysisTableMeta`) so the model can write the program; the rows stay in the browser. The
 * program goes out and the printed result comes back through Realtime broadcasts — nothing is stored
 * (the same rule as SQEM-649's continuation state).
 *
 * Pure apart from the injected `run`: chat-message wires the broadcast round trip, tests a fake.
 */

import type { ToolRuntime, ToolDefinition } from './libraryTools.ts';
import type { ConnectorTableStore, ConnectorTable } from './connectorTables.ts';

export interface AnalysisTableMeta {
  key: string;
  rows: number;
  columns: string[];
}

export interface AnalysisRunResult {
  ok: boolean;
  output: string;
  error?: string;
  truncated?: boolean;
  /** Python never started in the browser (or the browser never answered): the program did not run. */
  unstarted?: boolean;
  /** SQEM-661 — connector tables that did not reach the browser whole; the program did not run. */
  missingTables?: string[];
  /** SQEM-662 — the files the program wrote to /out/ and the person got: name and size, never the bytes. */
  files?: AnalysisFileMeta[];
  /** SQEM-662 — what it wrote there that was not handed out (not .xlsx, too large, too many). */
  skipped?: string[];
}

export interface AnalysisFileMeta {
  name: string;
  size: number;
}

/** SQEM-662 — as the frame hands them out (public/analysis-sandbox.html). */
export const MAX_ANALYSIS_FILES = 3;
export const MAX_ANALYSIS_FILE_BYTES = 5 * 1024 * 1024;

export function normalizeFileMetas(v: unknown): AnalysisFileMeta[] {
  if (!Array.isArray(v)) return [];
  return v.filter((f: any) => f && typeof f.name === 'string' && Number.isFinite(f.size))
    .slice(0, MAX_ANALYSIS_FILES)
    .map((f: any) => ({ name: String(f.name).slice(0, 120), size: Math.max(0, Math.floor(f.size)) }));
}

/** What the answer shows under it ("Analysis run"), and what the next invocation carries on with. */
export interface AnalysisRecord {
  code: string;
  ok: boolean;
  /** Why it failed, shown under the program — "(0)" alone told the reader nothing (2026-11-06). */
  error?: string;
  /** For the `[chat-tools]` counts only; never shown, never stored. */
  unstarted?: boolean;
  /** SQEM-661 — a connector table did not reach the browser whole. Counts only, like `unstarted`. */
  incomplete?: boolean;
  /** SQEM-662 — the files it handed the person (live view only; stored as a count). */
  files?: AnalysisFileMeta[];
}

const MAX_ERROR_SHOWN = 300;

/**
 * The END of an error, in whole lines that fit: a Python traceback starts with the call stack and
 * names the reason in its LAST line — the first 300 characters showed only
 * "Traceback … _base.py" (2026-11-06).
 */
export function errorTail(err: string, max = MAX_ERROR_SHOWN): string {
  const lines = String(err).trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let out = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = out ? `${lines[i]}\n${out}` : lines[i];
    if (next.length > max) break;
    out = next;
  }
  return out || String(err).trim().slice(-max);
}

/**
 * What the chat stores with the answer (chat_messages.analyses): only whether each run worked —
 * count and success, no program, no reason. A program can carry values the model
 * saw in the excerpt, a reason a cell value; both stay in the live view of the answer only.
 */
export interface StoredAnalysis {
  ok: boolean;
  /**
   * SQEM-662 — how many files the run handed out. A count, not a name: the file itself is never stored
   * (decided 2026-11-07: gone after a reload is fine), so the card can only say that a new question makes
   * it again. Fits the column's CHECK (≤ 6 entries, ≤ 1 KB) without a migration.
   */
  fileCount?: number;
}

/** What the card shows: live with program, reason and files, after a reload only `ok` and the count. */
export type ShownAnalysis = StoredAnalysis & { code?: string; error?: string; files?: AnalysisFileMeta[] };

export function storedAnalyses(records: AnalysisRecord[]): StoredAnalysis[] {
  return records.slice(0, MAX_ANALYSES_PER_ANSWER).map(a => ({ ok: a.ok === true, ...(a.files?.length ? { fileCount: a.files.length } : {}) }));
}

export function normalizeStoredAnalyses(v: unknown): StoredAnalysis[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a: any) => a && typeof a.ok === 'boolean').slice(0, MAX_ANALYSES_PER_ANSWER)
    .map((a: any) => ({ ok: a.ok, ...(Number.isInteger(a.fileCount) && a.fileCount > 0 ? { fileCount: Math.min(a.fileCount, MAX_ANALYSIS_FILES) } : {}) }));
}

export const MAX_ANALYSES_PER_ANSWER = 6;
export const MAX_TABLES = 20;
const MAX_COLUMNS_SHOWN = 40;
const MAX_CODE_CHARS = 20_000;

/** Only what the model needs, bounded; anything malformed is dropped. */
export function normalizeAnalysisTables(v: unknown): AnalysisTableMeta[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t: any) => t && typeof t.key === 'string' && t.key.trim())
    .slice(0, MAX_TABLES)
    .map((t: any) => ({
      key: String(t.key).slice(0, 200),
      rows: Number.isFinite(t.rows) ? Math.max(0, Math.floor(t.rows)) : 0,
      columns: (Array.isArray(t.columns) ? t.columns : []).filter((c: unknown) => typeof c === 'string').slice(0, 200).map((c: string) => c.slice(0, 120)),
    }));
}

/**
 * The table that is also `df`: the only one, or the only one with rows — a workbook's empty sheets
 * do not count. A test file had several sheets, so `df` was None and the model's first program
 * failed on it (2026-11-06). ⚠️ The frame (public/analysis-sandbox.html) picks by the same rule.
 */
export function dfTableKey(tables: AnalysisTableMeta[]): string | null {
  if (tables.length === 1) return tables[0].key;
  const withRows = tables.filter(t => t.rows > 0);
  return withRows.length === 1 ? withRows[0].key : null;
}

function describeTables(tables: AnalysisTableMeta[]): string {
  return tables.map(t => {
    const cols = t.columns.slice(0, MAX_COLUMNS_SHOWN).map(c => JSON.stringify(c)).join(', ')
      + (t.columns.length > MAX_COLUMNS_SHOWN ? `, … (${t.columns.length - MAX_COLUMNS_SHOWN} more)` : '');
    return `- tables[${JSON.stringify(t.key)}]: ${t.rows.toLocaleString('en-US')} rows; columns: ${cols || '(none)'}`;
  }).join('\n');
}

/**
 * SQEM-661 — `connectors`: connector results that are lists become tables during the answer. They are
 * named in the connector's own result, not here: this description is part of the cached start of every
 * request (SQEM-654) and must not change while the answer runs.
 */
/**
 * SQEM-662 — the one way a program hands the person a file: openpyxl into /out/. ⚠️ openpyxl writes a
 * formula without its value (Excel computes it on opening), so the model also writes the numbers it
 * computed where the person should read them — the preview beside the chat shows values only.
 */
export const EXCEL_FILE_LINE =
  'To give the person an Excel file with exact numbers, formulas or several sheets, write it in the same program with openpyxl to /out/<name>.xlsx '
  + `(at most ${MAX_ANALYSIS_FILES} files, ${MAX_ANALYSIS_FILE_BYTES / 1024 / 1024} MB each): it reaches the person as a download under the answer, and you get its name and size back. `
  + 'Formulas are kept and computed by Excel when the file is opened, so also write the computed values where the person should read them. Prefer this over create_file whenever the numbers come from a program.';

export function analysisToolDefinition(tables: AnalysisTableMeta[], { connectors = false }: { connectors?: boolean } = {}): ToolDefinition {
  if (!tables.length && connectors) {
    return {
      name: 'run_analysis',
      description:
        'Run a Python program (pandas as pd, numpy as np) in the person’s browser on tables from connector results, and get back what it prints. '
        + 'A connector result that is a list names the tables it became, e.g. tables["Service · tool #1"]; each is a pandas DataFrame in `tables`. '
        + 'Use it for anything that needs counting, summing, filtering, grouping or comparing across rows — never estimate such numbers from the text of a result. '
        + 'Values are as the connector sent them, so convert types as needed (pd.to_numeric, pd.to_datetime). '
        + 'Print the result, or end the program with an expression. No network, no installs; 30 seconds per run. '
        + EXCEL_FILE_LINE,
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The Python program. Print what the answer needs; keep the output short (a number, a small table).' } },
        required: ['code'],
      },
    };
  }
  return {
    name: 'run_analysis',
    description:
      'Run a Python program (pandas as pd, numpy as np) on the person’s attached tables, in their browser, and get back what it prints. '
      + 'Use it for anything that needs counting, summing, filtering, grouping or comparing across rows — never estimate such numbers from a text excerpt. '
      + 'Each table is a pandas DataFrame in `tables`. '
      + (dfTableKey(tables) ? `\`df\` is tables[${JSON.stringify(dfTableKey(tables))}]. ` : 'There is no `df`: pick the table from `tables` by its key. ')
      + 'Values were read from the file as text, so convert types as needed (pd.to_numeric, pd.to_datetime). '
      + 'Print the result, or end the program with an expression. No network, no installs; 30 seconds per run. '
      + EXCEL_FILE_LINE + '\n\nTables:\n'
      + describeTables(tables)
      + (connectors ? '\n\nA connector result that is a list also becomes tables here; the result names them.' : ''),
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The Python program. Print what the answer needs; keep the output short (a number, a small table).' } },
      required: ['code'],
    },
  };
}

/**
 * ⚠️ The filter line is what makes the number checkable: the same question asked twice
 * got 415 and 513 (2026-11-06), both computed exactly, with two readings of "children's bikes". The
 * programs are not stored (step C), so only the answer text can say after a reload what was counted.
 */
export const ANALYSIS_INSTRUCTION =
  'Attached tables can be analysed exactly with the run_analysis tool. Counts, sums, averages and filters over them come from a run_analysis result, not from the text excerpt of the file. '
  + 'Say in one short line that you computed it and which rows you counted: the columns and values you filtered on (for example: Counted: Category = Bikes, Group = Kids). '
  + 'If the question can be read more than one way, say which reading you used. Then give the number. '
  + 'An Excel file of computed numbers is written by the program itself (openpyxl, see run_analysis), never retyped into create_file.';

/** SQEM-661 — the same rule for connector results (in the changing part of the instruction, like the one above). */
export const CONNECTOR_ANALYSIS_INSTRUCTION =
  'A connector result that is a list is also available to run_analysis as tables, named at the end of that result. Counts, sums, totals, top lists and outliers over such a list come from a run_analysis result, never from the text of the result and never copied into a program by hand. '
  + 'Fetch every page you need first, then compute. Say in one short line what you computed and over which rows, then give the numbers. '
  + 'An Excel file of computed numbers is written by the program itself (openpyxl, see run_analysis), never retyped into create_file.';

export function formatAnalysisResult(r: AnalysisRunResult): string {
  if (r.ok) {
    const files = r.files?.length
      ? `\nFiles handed to the person under the answer: ${r.files.map(f => `${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`).join(', ')}. Do not repeat their contents; say in one line what they hold.`
      : '';
    const skipped = r.skipped?.length
      ? `\nNot handed out (only .xlsx, at most ${MAX_ANALYSIS_FILES} files of ${MAX_ANALYSIS_FILE_BYTES / 1024 / 1024} MB each): ${r.skipped.join(', ')}.`
      : '';
    return `Program output:\n${r.output || '(nothing printed)'}${r.truncated ? '\n[output cut at 20,000 characters]' : ''}${files}${skipped}`;
  }
  return `The program failed: ${r.error || 'unknown error'}${r.output ? `\nOutput before the failure:\n${r.output}` : ''}\n`
    + 'Fix the program and run it again (at most twice), or tell the person it could not be computed.';
}

/**
 * Adds `run_analysis` to a runtime when the message has tables. `run` delivers the program to the
 * browser and resolves with its result; a failure there becomes the tool's answer, never the
 * whole message lost. `records` collects what ran, for the answer's "Analysis run" line.
 */
export function withAnalysisTool(
  runtime: ToolRuntime,
  tables: AnalysisTableMeta[],
  // SQEM-661 — `pending`: connector tables the browser does not hold yet; they travel ahead of the program.
  run: (code: string, pending: ConnectorTable[]) => Promise<AnalysisRunResult>,
  records: AnalysisRecord[],
  connectorTables?: ConnectorTableStore,
): ToolRuntime {
  if (!tables.length && !connectorTables) return runtime;
  return {
    ...runtime,
    definitions: [...runtime.definitions, analysisToolDefinition(tables, { connectors: !!connectorTables })],
    stats: runtime.stats,
    async execute(name, args) {
      if (name !== 'run_analysis') return runtime.execute(name, args);
      runtime.stats.calls += 1;
      runtime.stats.byTool[name] = (runtime.stats.byTool[name] ?? 0) + 1;
      const code = String(args?.code ?? '').slice(0, MAX_CODE_CHARS);
      if (!code.trim()) return 'run_analysis needs a program in "code".';
      if (records.length >= MAX_ANALYSES_PER_ANSWER) {
        return `The analysis limit for one answer (${MAX_ANALYSES_PER_ANSWER}) is reached. Answer with what you have.`;
      }
      const pending = connectorTables?.pending() ?? [];
      let result: AnalysisRunResult;
      try {
        result = await run(code, pending);
        // SQEM-661 — what arrived whole is the browser's now; the rest goes again with the next program.
        const missing = new Set(result.missingTables ?? []);
        connectorTables?.markSent(pending.map(t => t.key).filter(k => !missing.has(k)));
        if (missing.size) {
          // Counted as incomplete, not as "Python did not start": the monitor names the transport, not the runtime.
          result = { ok: false, output: '', missingTables: [...missing], error: `Connector data did not reach the browser whole (${[...missing].join(', ')}); the program did not run. Run the same program again.` };
        }
      } catch (err: any) {
        // No answer from the browser at all counts as not started: the program cannot have run.
        result = { ok: false, output: '', error: err?.message ?? 'the browser did not answer', unstarted: true };
      }
      records.push(result.ok ? { code, ok: true, ...(result.files?.length ? { files: normalizeFileMetas(result.files) } : {}) } : { code, ok: false, error: errorTail(String(result.error || 'unknown error')), ...(result.unstarted ? { unstarted: true } : {}), ...(result.missingTables?.length ? { incomplete: true } : {}) });
      return formatAnalysisResult(result);
    },
  };
}

/**
 * SQEM-660 step C — the counts `[chat-tools]` carries for the ops monitor (scripts/ops-monitor). Counts
 * only: no program, no reason.
 */
export function analysisLogCounts(records: AnalysisRecord[]): { analyses: number; analysesFailed: number; analysesUnstarted: number; analysesIncomplete?: number } {
  const incomplete = records.filter(r => r.incomplete).length; // SQEM-661 — only when it happened
  return {
    analyses: records.length,
    analysesFailed: records.filter(r => !r.ok).length,
    analysesUnstarted: records.filter(r => r.unstarted).length,
    ...(incomplete ? { analysesIncomplete: incomplete } : {}),
  };
}

/** Shape-check for what the client stores and replays. */
export function normalizeAnalyses(v: unknown): AnalysisRecord[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a: any) => a && typeof a.code === 'string').slice(0, MAX_ANALYSES_PER_ANSWER)
    .map((a: any) => (a.ok
      ? { code: String(a.code).slice(0, MAX_CODE_CHARS), ok: true, ...(normalizeFileMetas(a.files).length ? { files: normalizeFileMetas(a.files) } : {}) }
      : { code: String(a.code).slice(0, MAX_CODE_CHARS), ok: false, ...(typeof a.error === 'string' && a.error ? { error: errorTail(a.error) } : {}),
        // SQEM-661 — the counts flags ride along a hand-over too: only the last invocation logs them.
        ...(a.unstarted === true ? { unstarted: true } : {}), ...(a.incomplete === true ? { incomplete: true } : {}) }));
}
