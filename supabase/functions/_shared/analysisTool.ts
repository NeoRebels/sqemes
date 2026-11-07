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
}

/** What the answer shows under it ("Analysis run"), and what the next invocation carries on with. */
export interface AnalysisRecord {
  code: string;
  ok: boolean;
  /** Why it failed, shown under the program — "(0)" alone told the reader nothing (2026-11-06). */
  error?: string;
  /** For the `[chat-tools]` counts only; never shown, never stored. */
  unstarted?: boolean;
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
}

/** What the card shows: live with program and reason, after a reload only `ok`. */
export type ShownAnalysis = StoredAnalysis & { code?: string; error?: string };

export function storedAnalyses(records: AnalysisRecord[]): StoredAnalysis[] {
  return records.slice(0, MAX_ANALYSES_PER_ANSWER).map(a => ({ ok: a.ok === true }));
}

export function normalizeStoredAnalyses(v: unknown): StoredAnalysis[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a: any) => a && typeof a.ok === 'boolean').slice(0, MAX_ANALYSES_PER_ANSWER).map((a: any) => ({ ok: a.ok }));
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

export function analysisToolDefinition(tables: AnalysisTableMeta[]): ToolDefinition {
  return {
    name: 'run_analysis',
    description:
      'Run a Python program (pandas as pd, numpy as np) on the person’s attached tables, in their browser, and get back what it prints. '
      + 'Use it for anything that needs counting, summing, filtering, grouping or comparing across rows — never estimate such numbers from a text excerpt. '
      + 'Each table is a pandas DataFrame in `tables`. '
      + (dfTableKey(tables) ? `\`df\` is tables[${JSON.stringify(dfTableKey(tables))}]. ` : 'There is no `df`: pick the table from `tables` by its key. ')
      + 'Values were read from the file as text, so convert types as needed (pd.to_numeric, pd.to_datetime). '
      + 'Print the result, or end the program with an expression. No network, no files, no installs; 30 seconds per run.\n\nTables:\n'
      + describeTables(tables),
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
  + 'If the question can be read more than one way, say which reading you used. Then give the number.';

export function formatAnalysisResult(r: AnalysisRunResult): string {
  if (r.ok) {
    return `Program output:\n${r.output || '(nothing printed)'}${r.truncated ? '\n[output cut at 20,000 characters]' : ''}`;
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
  run: (code: string) => Promise<AnalysisRunResult>,
  records: AnalysisRecord[],
): ToolRuntime {
  if (!tables.length) return runtime;
  return {
    ...runtime,
    definitions: [...runtime.definitions, analysisToolDefinition(tables)],
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
      let result: AnalysisRunResult;
      try {
        result = await run(code);
      } catch (err: any) {
        // No answer from the browser at all counts as not started: the program cannot have run.
        result = { ok: false, output: '', error: err?.message ?? 'the browser did not answer', unstarted: true };
      }
      records.push(result.ok ? { code, ok: true } : { code, ok: false, error: errorTail(String(result.error || 'unknown error')), ...(result.unstarted ? { unstarted: true } : {}) });
      return formatAnalysisResult(result);
    },
  };
}

/**
 * SQEM-660 step C — the counts `[chat-tools]` carries for the ops monitor (scripts/ops-monitor). Counts
 * only: no program, no reason.
 */
export function analysisLogCounts(records: AnalysisRecord[]): { analyses: number; analysesFailed: number; analysesUnstarted: number } {
  return {
    analyses: records.length,
    analysesFailed: records.filter(r => !r.ok).length,
    analysesUnstarted: records.filter(r => r.unstarted).length,
  };
}

/** Shape-check for what the client stores and replays. */
export function normalizeAnalyses(v: unknown): AnalysisRecord[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a: any) => a && typeof a.code === 'string').slice(0, MAX_ANALYSES_PER_ANSWER)
    .map((a: any) => (a.ok
      ? { code: String(a.code).slice(0, MAX_CODE_CHARS), ok: true }
      : { code: String(a.code).slice(0, MAX_CODE_CHARS), ok: false, ...(typeof a.error === 'string' && a.error ? { error: errorTail(a.error) } : {}) }));
}
