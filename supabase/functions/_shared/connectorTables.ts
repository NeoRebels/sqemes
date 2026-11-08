/**
 * SQEM-661 — a connector result that is a LIST becomes tables for `run_analysis` (step 2 of SQEM-660).
 *
 * ⛔ Why: an ERP, CRM or accounting connector answers with lists — invoices, positions, orders — and a
 * review needs sums over them. In the model's context they are text: past 60,000 characters they are
 * cut, and below that the model would have to copy hundreds of amounts into a program by hand, which
 * it rightly refuses. So every list result ALSO becomes a table the browser can compute on, whatever
 * its size: the model then works the same way for 20 invoices as for 2,000.
 *
 * Shapes this reads (each one met in a real connector):
 * - a bare list of objects, `[{…}, …]`;
 * - a list under a key, `{"result": [...]}` (weclapp v2), `{"data": {"items": [...]}}`;
 * - a list INSIDE every row, `salesInvoiceItems` of each invoice: it becomes its own table, and each of
 *   its rows carries the parent's plain fields as `parent.<field>` — the top articles are computed over
 *   positions, and a position alone does not say which invoice it belongs to;
 * - plain nested objects are flattened (`customer.name`).
 *
 * Values stay as the connector sent them: numbers that arrive as text ("123.45") stay text, dates in
 * milliseconds stay numbers. The note to the model names both conversions; guessing them here would be
 * wrong for some connector.
 *
 * Pure: no Deno, no fetch — the unit tests import it.
 */

export interface ConnectorTable {
  key: string;
  rows: number;
  columns: string[];
  csv: string;
}

const MAX_TABLES_PER_RESULT = 8;
const MAX_ROWS_PER_TABLE = 50_000;
const MAX_COLUMNS = 200;
/** All tables of one result together; above it the result is left as text only (and says so). */
export const MAX_TABLE_CHARS_PER_RESULT = 5_000_000;
/** Below this the whole result also stays in the model's context; above it the model gets a preview. */
export const FULL_TEXT_MAX_CHARS = 20_000;
const PREVIEW_ROWS = 3;
const MAX_DEPTH = 3;

type Row = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const isObjectList = (v: unknown): v is Row[] => Array.isArray(v) && v.length > 0 && v.every(isPlainObject);

/**
 * The JSON of a result: the text itself, or — when a connector puts a line of text around it ("Found 12
 * orders:" …) — the part from the first `{`/`[` to the last `}`/`]`. Not JSON at all: undefined.
 */
export function parseResultJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* maybe wrapped */ }
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return undefined; }
}

/** The list a result is about: itself, or the largest list of objects up to two keys deep. */
export function findMainList(value: unknown): { path: string; rows: Row[] } | null {
  if (isObjectList(value)) return { path: '', rows: value };
  if (!isPlainObject(value)) return null;
  let best: { path: string; rows: Row[] } | null = null;
  const consider = (path: string, v: unknown) => {
    if (isObjectList(v) && (!best || v.length > best.rows.length)) best = { path, rows: v };
  };
  for (const [k, v] of Object.entries(value)) {
    consider(k, v);
    if (isPlainObject(v)) for (const [k2, v2] of Object.entries(v)) consider(`${k}.${k2}`, v2);
  }
  return best;
}

/**
 * One row as plain cells, plus the lists of objects inside it (by field path). Arrays of plain values
 * become one JSON cell — a tag list is a value, not a table.
 */
function flatten(row: Row, prefix = '', depth = 0, cells: Row = {}, lists: Map<string, Row[]> = new Map()): { cells: Row; lists: Map<string, Row[]> } {
  for (const [k, v] of Object.entries(row)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (isObjectList(v)) {
      const list = lists.get(name) ?? [];
      list.push(...v);
      lists.set(name, list);
    } else if (Array.isArray(v)) {
      cells[name] = v.length ? JSON.stringify(v) : '';
    } else if (isPlainObject(v) && depth < MAX_DEPTH) {
      flatten(v, name, depth + 1, cells, lists);
    } else if (isPlainObject(v)) {
      cells[name] = JSON.stringify(v);
    } else {
      cells[name] = v;
    }
  }
  return { cells, lists };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

function toTable(key: string, rows: Row[]): ConnectorTable {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const c of Object.keys(r)) {
    if (!seen.has(c) && columns.length < MAX_COLUMNS) { seen.add(c); columns.push(c); }
  }
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(columns.map(c => csvCell(r[c])).join(','));
  return { key, rows: rows.length, columns, csv: lines.join('\n') };
}

/**
 * The tables of one connector result, or [] when it is not a list of objects (or not JSON at all).
 * `key` names the main table; a list inside its rows is `<key> / <field>`.
 */
export function connectorResultTables(text: string, key: string): ConnectorTable[] {
  const main = findMainList(parseResultJson(text));
  if (!main) return [];
  const out: ConnectorTable[] = [];
  const build = (tableKey: string, rows: Row[], parents: Row[] | null, level: number) => {
    if (out.length >= MAX_TABLES_PER_RESULT) return;
    const flatRows: Row[] = [];
    const children = new Map<string, { rows: Row[]; parents: Row[] }>();
    rows.slice(0, MAX_ROWS_PER_TABLE).forEach((r, i) => {
      const { cells, lists } = flatten(r);
      // A child row carries its parent's plain fields — the invoice a position belongs to.
      if (parents) for (const [pk, pv] of Object.entries(parents[i])) cells[`parent.${pk}`] = pv;
      flatRows.push(cells);
      for (const [field, list] of lists) {
        const c = children.get(field) ?? { rows: [], parents: [] };
        for (const item of list) { c.rows.push(item); c.parents.push(cells); }
        children.set(field, c);
      }
    });
    out.push(toTable(tableKey, flatRows));
    if (level >= 2) return; // invoices → positions → (their lists); deeper is not a table any connector needed
    for (const [field, c] of children) {
      // Only the parent's own plain fields travel down, not its `parent.*` (one level is enough to join).
      const plainParents = c.parents.map(p => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('parent.'))));
      build(`${tableKey} / ${field}`, c.rows, plainParents, level + 1);
    }
  };
  build(key, main.rows, null, 1);
  const total = out.reduce((n, t) => n + t.csv.length, 0);
  return total > MAX_TABLE_CHARS_PER_RESULT ? [] : out;
}

/**
 * SQEM-661 — characters of CSV per broadcast message. ⚠️ Realtime limits a message by BYTES, and the
 * smallest plan allows 256 KB: 60,000 characters stay under it even when every one is a three-byte
 * character, JSON escaping included. A 2 MB table is about 35 messages, sent one after the other.
 */
export const TABLE_PART_CHARS = 60_000;

/** A table in parts for the broadcast (`analysisRoundTrip.ts`); the browser joins them in order. */
export function tableParts(t: ConnectorTable): string[] {
  const parts: string[] = [];
  for (let i = 0; i < t.csv.length; i += TABLE_PART_CHARS) parts.push(t.csv.slice(i, i + TABLE_PART_CHARS));
  return parts.length ? parts : [''];
}

/**
 * SQEM-661 — why a result did NOT become a table, for the edge log (`[chat-tables]`): a connector that
 * wraps its JSON in text, or answers with something else, shows here instead of silently computing
 * nothing.
 */
export function noTableReason(text: string): 'not-json' | 'no-list' | 'too-large' {
  const parsed = parseResultJson(text);
  if (parsed === undefined) return 'not-json';
  return findMainList(parsed) ? 'too-large' : 'no-list';
}

/** The first rows of the main table as JSON — what the model sees of a large result. */
function preview(text: string): string {
  try {
    const main = findMainList(parseResultJson(text));
    if (!main) return '';
    return JSON.stringify(main.rows.slice(0, PREVIEW_ROWS), null, 1).slice(0, 4000);
  } catch { return ''; }
}

const describe = (t: ConnectorTable) =>
  `- tables[${JSON.stringify(t.key)}]: ${t.rows.toLocaleString('en-US')} rows; columns: ${t.columns.slice(0, 40).map(c => JSON.stringify(c)).join(', ')}${t.columns.length > 40 ? `, … (${t.columns.length - 40} more)` : ''}`;

/**
 * What the model gets back for a list result: the text itself when it is small, a preview when it is
 * large — and in both cases the tables it can compute on, with the two conversions connectors need.
 */
export function connectorResultForModel(text: string, tables: ConnectorTable[], boundedText: string): string {
  if (!tables.length) return boundedText;
  const note = '[sqemes: this result is also available to run_analysis as these tables — compute counts, sums, top lists and filters there, never from this text:\n'
    + tables.map(describe).join('\n')
    + '\nValues are as the connector sent them: convert numbers sent as text with pd.to_numeric, and dates in milliseconds with pd.to_datetime(..., unit="ms"). '
    + 'Several pages of the same list are separate tables: combine them with pd.concat([...]).drop_duplicates() (by the id column when there is one). '
    + 'In a table of a list inside each row, every row carries the fields of its parent row as parent.<field>.]';
  if (text.length <= FULL_TEXT_MAX_CHARS) return `${boundedText}\n\n${note}`;
  const p = preview(text);
  return `The connector returned ${text.length.toLocaleString('en-US')} characters — a list too long to read here.${p ? ` The first ${PREVIEW_ROWS} rows:\n${p}` : ''}\n\n${note}`;
}

/**
 * The connector tables of ONE answer (one invocation): what was built, and what the browser already
 * holds. Never stored — the rows live in the browser once sent.
 *
 * ⚠️ A hand-over to a fresh invocation (SQEM-649) starts with an empty store: tables the browser
 * already holds still work there, a table built but never sent before the hand-over is gone, and the
 * model fetches that page again. Rare (a hand-over comes after minutes of work) and honest: the
 * program then fails with the missing key, it never computes on part of the data.
 */
export class ConnectorTableStore {
  private readonly tables: ConnectorTable[] = [];
  private readonly sent = new Set<string>();
  private readonly counts = new Map<string, number>();
  /** How many tables this answer built — for the `[chat-tools]` line. */
  built = 0;

  /** `onResult` sees every list result: the tables it became, or why none (for the edge log). */
  constructor(private readonly onResult?: (info: { connector: string; tool: string; chars: number }, outcome: { tables: ConnectorTable[] } | { reason: string }) => void) {}

  /** `Service · tool #n`, numbered per tool within the answer, so every page has its own key. */
  nextKey(connector: string, tool: string): string {
    const base = `${connector} · ${tool}`;
    const n = (this.counts.get(base) ?? 0) + 1;
    this.counts.set(base, n);
    return `${base} #${n}`;
  }

  add(tables: ConnectorTable[]): void {
    this.tables.push(...tables);
    this.built += tables.length;
  }

  pending(): ConnectorTable[] {
    return this.tables.filter(t => !this.sent.has(t.key));
  }

  markSent(keys: string[]): void {
    for (const k of keys) this.sent.add(k);
  }

  /** The hook for `loadConnectorTools`: a list result becomes tables, the model gets the note. */
  hook(): (info: { connector: string; tool: string }, fullText: string, boundedText: string) => string | null {
    return (info, fullText, boundedText) => {
      const base = `${info.connector} · ${info.tool}`;
      const tables = connectorResultTables(fullText, `${base} #${(this.counts.get(base) ?? 0) + 1}`);
      if (!tables.length) { // not a list: no number used up
        this.onResult?.({ ...info, chars: fullText.length }, { reason: noTableReason(fullText) });
        return null;
      }
      this.onResult?.({ ...info, chars: fullText.length }, { tables });
      this.nextKey(info.connector, info.tool);
      this.add(tables);
      return connectorResultForModel(fullText, tables, boundedText);
    };
  }
}
