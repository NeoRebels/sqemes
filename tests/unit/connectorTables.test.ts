import { describe, it, expect, vi } from 'vitest';
import {
  connectorResultTables, connectorResultForModel, findMainList, ConnectorTableStore, FULL_TEXT_MAX_CHARS, MAX_TABLE_CHARS_PER_RESULT,
  tableParts, TABLE_PART_CHARS,
} from '../../supabase/functions/_shared/connectorTables';
import { McpSession, MCP_RESULT_MAX_CHARS } from '../../supabase/functions/_shared/mcpClient';
import { withAnalysisTool, analysisToolDefinition, CONNECTOR_ANALYSIS_INSTRUCTION, type AnalysisRecord } from '../../supabase/functions/_shared/analysisTool';
import { jobEventFor, JOB_EVENTS } from '../../supabase/functions/_shared/jobEvents';
import { ConnectorTableParts, programWithDf } from '../../lib/connectorTableParts';
import type { ToolRuntime } from '../../supabase/functions/_shared/libraryTools';

/** SQEM-661 — connector results that are lists become tables for run_analysis. */

/** A minimal CSV reader for the checks (quotes doubled, commas and newlines inside quotes). */
function readCsv(csv: string): Record<string, string>[] {
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
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** A weclapp v2 answer: `{ result: [...] }`, positions inside each invoice, numbers as text, dates in ms. */
function invoices(n: number) {
  return {
    result: Array.from({ length: n }, (_, i) => ({
      id: String(1000 + i),
      invoiceNumber: `RE-${i + 1}`,
      salesInvoiceType: i % 10 === 9 ? 'CREDIT_NOTE' : 'STANDARD_INVOICE',
      headerDiscount: '0',
      invoiceDate: Date.UTC(2023 + (i % 3), i % 12, 1),
      customer: { id: '77', name: 'Test, "Customer" A' },
      salesInvoiceItems: [
        { articleId: `A${i % 5}`, netAmount: (100 + i).toFixed(2), quantity: '1' },
        { articleId: `A${(i + 1) % 5}`, netAmount: '0.50', quantity: '2' },
      ],
    })),
  };
}

describe('connectorResultTables — the shapes connectors answer with', () => {
  it('weclapp: the list under `result`, positions as their own table carrying the invoice fields', () => {
    const tables = connectorResultTables(JSON.stringify(invoices(150)), 'weclapp · weclapp_sales_invoices #1');
    expect(tables.map(t => [t.key, t.rows])).toEqual([
      ['weclapp · weclapp_sales_invoices #1', 150],
      ['weclapp · weclapp_sales_invoices #1 / salesInvoiceItems', 300],
    ]);
    const heads = readCsv(tables[0].csv);
    expect(tables[0].columns).toEqual(['id', 'invoiceNumber', 'salesInvoiceType', 'headerDiscount', 'invoiceDate', 'customer.id', 'customer.name']);
    expect(heads[0]['customer.name']).toBe('Test, "Customer" A'); // comma and quotes survive
    const items = readCsv(tables[1].csv);
    expect(tables[1].columns).toContain('parent.invoiceNumber');
    expect(tables[1].columns).toContain('parent.salesInvoiceType');
    expect(tables[1].columns).not.toContain('parent.salesInvoiceItems');
    // The sum a review needs, exactly: (100 + i) + 0.50 per invoice.
    const expected = Array.from({ length: 150 }, (_, i) => 100 + i + 0.5).reduce((a, b) => a + b, 0);
    expect(items.reduce((a, r) => a + Number(r.netAmount), 0)).toBeCloseTo(expected, 6);
    expect(items[0]['parent.invoiceNumber']).toBe('RE-1');
    // Values as sent: text numbers stay text, ms dates stay numbers (the note names both conversions).
    expect(heads[0].invoiceDate).toBe(String(Date.UTC(2023, 0, 1)));
  });

  it('a bare list, a list two keys deep, and the largest list wins', () => {
    expect(connectorResultTables('[{"a":1},{"a":2}]', 'k')[0].rows).toBe(2);
    expect(findMainList({ data: { items: [{ a: 1 }, { a: 2 }, { a: 3 }] }, meta: [{ x: 1 }] })?.path).toBe('data.items');
  });

  it('not a list of objects: no table (text, a single object, a list of values, a tool error)', () => {
    expect(connectorResultTables('ran search', 'k')).toEqual([]);
    expect(connectorResultTables('{"id":1,"name":"x"}', 'k')).toEqual([]);
    expect(connectorResultTables('["a","b"]', 'k')).toEqual([]);
    expect(connectorResultTables('[]', 'k')).toEqual([]);
  });

  it('a list of plain values inside a row is one cell, not a table', () => {
    const t = connectorResultTables('[{"id":1,"tags":["x","y"]}]', 'k');
    expect(t).toHaveLength(1);
    expect(readCsv(t[0].csv)[0].tags).toBe('["x","y"]');
  });

  it('above the size limit the result stays text only', () => {
    const big = JSON.stringify(Array.from({ length: 30_000 }, (_, i) => ({ id: i, text: 'x'.repeat(200) })));
    expect(big.length).toBeGreaterThan(MAX_TABLE_CHARS_PER_RESULT);
    expect(connectorResultTables(big, 'k')).toEqual([]);
  });
});

describe('connectorResultForModel — what the model reads', () => {
  it('small: the text itself, then the tables and the two conversions', () => {
    const text = JSON.stringify(invoices(2));
    const out = connectorResultForModel(text, connectorResultTables(text, 'w #1'), text);
    expect(out.startsWith(text)).toBe(true);
    expect(out).toContain('tables["w #1 / salesInvoiceItems"]: 4 rows');
    expect(out).toContain('pd.to_numeric');
    expect(out).toContain('unit="ms"');
    expect(out).toContain('never from this text');
  });

  it('large: a preview instead of 60,000 characters of list', () => {
    const text = JSON.stringify(invoices(400));
    expect(text.length).toBeGreaterThan(FULL_TEXT_MAX_CHARS);
    const out = connectorResultForModel(text, connectorResultTables(text, 'w #1'), text.slice(0, MCP_RESULT_MAX_CHARS));
    expect(out.length).toBeLessThan(10_000);
    expect(out).toContain('The first 3 rows');
    expect(out).toContain('tables["w #1"]: 400 rows');
    expect(out).not.toContain('RE-400');
  });

  it('⛔ no apostrophe in the note (edge functions are not type-checked; one broke a deploy, SQEM-526)', () => {
    const text = '[{"a":1}]';
    expect(connectorResultForModel(text, connectorResultTables(text, 'k'), text)).not.toMatch(/'/);
    expect(CONNECTOR_ANALYSIS_INSTRUCTION).not.toMatch(/'/);
  });
});

describe('ConnectorTableStore — one answer', () => {
  it('numbers pages per tool, only for list results', () => {
    const store = new ConnectorTableStore();
    const hook = store.hook();
    const info = { connector: 'weclapp', tool: 'weclapp_sales_invoices' };
    expect(hook(info, 'not json', 'not json')).toBeNull();
    expect(hook(info, '[{"a":1}]', '[{"a":1}]')).toContain('tables["weclapp · weclapp_sales_invoices #1"]');
    expect(hook(info, '[{"a":2}]', '[{"a":2}]')).toContain('#2"]');
    expect(store.pending().map(t => t.key)).toEqual(['weclapp · weclapp_sales_invoices #1', 'weclapp · weclapp_sales_invoices #2']);
    store.markSent(['weclapp · weclapp_sales_invoices #1']);
    expect(store.pending().map(t => t.key)).toEqual(['weclapp · weclapp_sales_invoices #2']);
    expect(store.built).toBe(2);
  });
});

describe('McpSession — the hook sees the WHOLE result', () => {
  it('a list longer than the cut becomes tables from all of it', async () => {
    const text = JSON.stringify(invoices(600));
    expect(text.length).toBeGreaterThan(MCP_RESULT_MAX_CHARS);
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const msg = JSON.parse(String(init.body));
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = msg.method === 'tools/call' ? { content: [{ type: 'text', text }] } : { protocolVersion: '2024-11-05' };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }), { headers: { 'content-type': 'application/json' } });
    });
    const store = new ConnectorTableStore();
    const s = new McpSession({ url: 'https://x/mcp', token: null, displayName: 'weclapp', allowedTools: null }, fetchImpl, store.hook());
    const out = await s.callTool('weclapp_sales_invoices', {});
    expect(out).toContain('600 rows');
    expect(store.pending()[0].rows).toBe(600);
    expect(store.pending()[1].rows).toBe(1200);
  });

  it('without a hook nothing changes: the bounded text', async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const msg = JSON.parse(String(init.body));
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = msg.method === 'tools/call' ? { content: [{ type: 'text', text: '[{"a":1}]' }] } : {};
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }), { headers: { 'content-type': 'application/json' } });
    });
    const s = new McpSession({ url: 'https://x/mcp', token: null, displayName: 'x', allowedTools: null }, fetchImpl);
    expect(await s.callTool('t', {})).toBe('[{"a":1}]');
  });
});

describe('run_analysis with connector tables', () => {
  const base = (): ToolRuntime => ({
    definitions: [], stats: { calls: 0, byTool: {} } as any,
    execute: async () => 'base',
  } as unknown as ToolRuntime);

  it('offered without attachments when connectors can deliver tables; the description stays fixed', () => {
    const store = new ConnectorTableStore();
    const rt = withAnalysisTool(base(), [], async () => ({ ok: true, output: '' }), [], store);
    expect(rt.definitions.map(d => d.name)).toEqual(['run_analysis']);
    expect(rt.definitions[0].description).toContain('tables from connector results');
    expect(analysisToolDefinition([], { connectors: false }).description).toContain('attached tables');
    expect(withAnalysisTool(base(), [], async () => ({ ok: true, output: '' }), []).definitions).toEqual([]);
  });

  it('pending tables travel with the program; what arrived is not sent again', async () => {
    const store = new ConnectorTableStore();
    store.hook()({ connector: 'w', tool: 't' }, '[{"a":1}]', '');
    const run = vi.fn(async () => ({ ok: true, output: '1' }));
    const records: AnalysisRecord[] = [];
    const rt = withAnalysisTool(base(), [], run, records, store);
    await rt.execute('run_analysis', { code: 'print(1)' });
    expect((run.mock.calls[0] as any[])[1].map((t: { key: string }) => t.key)).toEqual(['w · t #1']);
    await rt.execute('run_analysis', { code: 'print(2)' });
    expect((run.mock.calls[1] as any[])[1]).toEqual([]);
  });

  it('⛔ a table that did not arrive whole: the program did not run, the model is told, it is sent again', async () => {
    const store = new ConnectorTableStore();
    store.hook()({ connector: 'w', tool: 't' }, '[{"a":1}]', '');
    const records: AnalysisRecord[] = [];
    const rt = withAnalysisTool(base(), [], async () => ({ ok: false, output: '', unstarted: true, missingTables: ['w · t #1'] }), records, store);
    const out = await rt.execute('run_analysis', { code: 'print(1)' });
    expect(out).toContain('did not reach the browser whole');
    expect(records[0]).toMatchObject({ ok: false, incomplete: true });
    expect(records[0].unstarted).toBeUndefined();
    expect(store.pending().map(t => t.key)).toEqual(['w · t #1']);
  });
});

describe('the transport', () => {
  it('a table goes in parts under the message limit, and the browser puts them together in any order', async () => {
    const csv = 'a\n' + '1\n'.repeat(TABLE_PART_CHARS);
    const parts = tableParts({ key: 'k', rows: 0, columns: ['a'], csv });
    expect(parts.length).toBe(Math.ceil(csv.length / TABLE_PART_CHARS));
    const got = new ConnectorTableParts();
    [...parts.keys()].reverse().forEach(i => got.add({ key: 'k', part: i, parts: parts.length, csv: parts[i] }));
    expect(await got.whenComplete([{ key: 'k' }], 10)).toEqual([]);
    expect(got.tables()[0].csv).toBe(csv);
  });

  it('⛔ a lost part is reported, not run on', async () => {
    const got = new ConnectorTableParts();
    got.add({ key: 'k', part: 0, parts: 2, csv: 'a\n1' });
    expect(await got.whenComplete([{ key: 'k' }], 20)).toEqual(['k']);
    expect(got.tables()).toEqual([]);
  });

  it('the event is its own, not terminal, and the client listens for it', () => {
    expect(jobEventFor({ analysisTable: { key: 'k' } })).toBe('analysis_table');
    expect(JOB_EVENTS).toContain('analysis_table');
  });

  it('df stays what the tool description said once connector tables sit beside the attachments', () => {
    expect(programWithDf('print(1)', 'a.xlsx', false)).toBe('print(1)');
    expect(programWithDf('print(1)', 'a.xlsx', true)).toBe('df = tables["a.xlsx"]\nprint(1)');
    expect(programWithDf('print(1)', null, true)).toBe('df = None\nprint(1)');
  });
});

describe('SQEM-661 — the backlog query (weclapp sales orders)', () => {
  /** `weclapp_sales_orders` with `properties` incl. `orderItems.*`: the list of items inside each order. */
  const orders = {
    result: [
      { id: '9001', orderNumber: 'AU-1', status: 'ORDER_CONFIRMATION_PRINTED', orderDate: Date.UTC(2026, 9, 1),
        orderItems: [
          { articleId: 'A1', quantity: '10', shippedQuantity: '4', netAmount: '100.00' },
          { articleId: 'A2', quantity: '2', shippedQuantity: '2', netAmount: '20.00' },
        ] },
      { id: '9002', orderNumber: 'AU-2', status: 'ORDER_ENTRY_IN_PROGRESS', orderDate: Date.UTC(2026, 10, 2),
        orderItems: [{ articleId: 'A1', quantity: '5', shippedQuantity: '0', netAmount: '50.00' }] },
    ],
  };

  it('orderItems is its own table, one row per item, with the order beside it — not a JSON cell', () => {
    const tables = connectorResultTables(JSON.stringify(orders), 'weclapp · weclapp_sales_orders #1');
    expect(tables.map(t => [t.key, t.rows])).toEqual([
      ['weclapp · weclapp_sales_orders #1', 2],
      ['weclapp · weclapp_sales_orders #1 / orderItems', 3],
    ]);
    expect(tables[0].columns).not.toContain('orderItems');
    const items = readCsv(tables[1].csv);
    expect(Object.keys(items[0])).toEqual(['articleId', 'quantity', 'shippedQuantity', 'netAmount', 'parent.id', 'parent.orderNumber', 'parent.status', 'parent.orderDate']);
    // The backlog: ordered minus shipped, per item — computable from this table alone.
    expect(items.reduce((n, r) => n + Number(r.quantity) - Number(r.shippedQuantity), 0)).toBe(11);
  });

  it('the store reports every list result: its tables, or why none (for the edge log)', () => {
    const seen: unknown[] = [];
    const store = new ConnectorTableStore((info, outcome) => seen.push({ tool: info.tool, ...('tables' in outcome ? { n: outcome.tables.length } : outcome) }));
    const hook = store.hook();
    hook({ connector: 'weclapp', tool: 'weclapp_sales_orders' }, JSON.stringify(orders), '');
    // A line of text around the JSON does not cost the tables.
    hook({ connector: 'weclapp', tool: 'weclapp_sales_orders' }, 'Found 2 orders:\n' + JSON.stringify(orders) + '\n(page 1 of 1)', '');
    hook({ connector: 'weclapp', tool: 'weclapp_whoami' }, '{"id":"1"}', '');
    hook({ connector: 'weclapp', tool: 'weclapp_note' }, 'Done, no data.', '');
    expect(seen).toEqual([
      { tool: 'weclapp_sales_orders', n: 2 },
      { tool: 'weclapp_sales_orders', n: 2 },
      { tool: 'weclapp_whoami', reason: 'no-list' },
      { tool: 'weclapp_note', reason: 'not-json' },
    ]);
    expect(store.pending().map(t => t.key)).toContain('weclapp · weclapp_sales_orders #2 / orderItems');
  });
});

describe('SQEM-661 — counts across a hand-over', () => {
  it('the flags the monitor counts ride along with the carried analyses', async () => {
    const { normalizeAnalyses, analysisLogCounts } = await import('../../supabase/functions/_shared/analysisTool');
    const carried = normalizeAnalyses([{ code: 'a', ok: false, error: 'x', unstarted: true }, { code: 'b', ok: false, error: 'y', incomplete: true }, { code: 'c', ok: true }]);
    expect(analysisLogCounts(carried)).toEqual({ analyses: 3, analysesFailed: 2, analysesUnstarted: 1, analysesIncomplete: 1 });
  });
});
