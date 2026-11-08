// SQEM-661 — the connector tables of the running answer, as they arrive in parts (`analysis_table`)
// ahead of the program that needs them. Kept in memory with the answer, never stored; gone when the
// answer ends.
//
// ⛔ A broadcast is best-effort. A table with a part missing is NOT handed to the program — the program
// would compute on part of the data and say a wrong number confidently. It is reported back instead
// (`missingTables`) and the server sends it again with the next program.
//
// No Supabase import: tests load this without env vars.

import type { AnalysisTable } from './analysisSandbox';

/** How long a program waits for parts still on their way (they are sent just before it). */
export const TABLE_PARTS_WAIT_MS = 5_000;

export class ConnectorTableParts {
  private readonly parts = new Map<string, { parts: number; got: Map<number, string> }>();
  private readonly done = new Map<string, string>();
  private waiters: (() => void)[] = [];

  add(p: { key: string; part: number; parts: number; csv: string }): void {
    if (this.done.has(p.key) || p.part < 0 || p.part >= p.parts) return;
    const e = this.parts.get(p.key) ?? { parts: p.parts, got: new Map<number, string>() };
    e.got.set(p.part, p.csv);
    this.parts.set(p.key, e);
    if (e.got.size === e.parts) {
      this.done.set(p.key, Array.from({ length: e.parts }, (_, i) => e.got.get(i) ?? '').join(''));
      this.parts.delete(p.key);
    }
    const w = this.waiters; this.waiters = []; w.forEach(f => f());
  }

  /** The keys of `expected` that are not complete yet. */
  missing(expected: { key: string }[]): string[] {
    return expected.map(e => e.key).filter(k => !this.done.has(k));
  }

  /** Resolves once every expected table is complete, or after `timeoutMs` with what is still missing. */
  async whenComplete(expected: { key: string }[], timeoutMs = TABLE_PARTS_WAIT_MS): Promise<string[]> {
    const end = Date.now() + timeoutMs;
    while (this.missing(expected).length && Date.now() < end) {
      await new Promise<void>(r => { const t = setTimeout(r, Math.max(0, end - Date.now())); this.waiters.push(() => { clearTimeout(t); r(); }); });
    }
    return this.missing(expected);
  }

  /** Every complete table, for the frame. */
  tables(): AnalysisTable[] {
    return [...this.done].map(([key, csv]) => ({ key, csv }));
  }
}

/**
 * The program as the frame runs it. With connector tables beside the attachments the frame's own rule
 * for `df` (the only table, or the only one with rows) would pick differently than the tool's
 * description said — so `df` is set here, exactly as the description promised.
 */
export function programWithDf(code: string, dfKey: string | null, hasConnectorTables: boolean): string {
  if (!hasConnectorTables) return code;
  return `${dfKey ? `df = tables[${JSON.stringify(dfKey)}]` : 'df = None'}\n${code}`;
}
