import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import writeExcelFile from 'write-excel-file/node';
import {
  analysisToolDefinition, withAnalysisTool, normalizeAnalysisTables, normalizeAnalyses, formatAnalysisResult,
  MAX_ANALYSES_PER_ANSWER, ANALYSIS_INSTRUCTION, type AnalysisRecord,
  errorTail, dfTableKey, storedAnalyses, normalizeStoredAnalyses, analysisLogCounts,
} from '../../supabase/functions/_shared/analysisTool';
import { workbookTables } from '../../supabase/functions/_shared/officeText';
import { tablesFromFile, uniqueTables, analysisTableMeta } from '../../lib/analysisTables';
import { JOB_EVENTS, jobEventFor } from '../../supabase/functions/_shared/jobEvents';
import type { ToolRuntime } from '../../supabase/functions/_shared/libraryTools';
import { en, de } from './i18nText';

// SQEM-660 step B — run_analysis: the program goes to the person's browser, the result comes back.

const runtime = (): ToolRuntime => ({
  definitions: [{ name: 'search_templates', description: 'x', parameters: { type: 'object', properties: {} } }],
  stats: { calls: 0, byTool: {} as Record<string, number> },
  execute: async (name: string) => `library:${name}`,
}) as unknown as ToolRuntime;

const TABLES = [{ key: 'stock.xlsx', rows: 12000, columns: ['Item', 'Description', 'Condition'] }];

describe('SQEM-660 — the tool', () => {
  it('names the tables, their size and columns — never rows', () => {
    const d = analysisToolDefinition(TABLES);
    expect(d.name).toBe('run_analysis');
    expect(d.description).toContain('tables["stock.xlsx"]: 12,000 rows; columns: "Item", "Description", "Condition"');
    expect(d.description).toMatch(/never estimate such numbers from a text excerpt/);
    expect(d.parameters.required).toEqual(['code']);
  });

  it('without tables the runtime is unchanged', () => {
    const r = runtime();
    expect(withAnalysisTool(r, [], async () => ({ ok: true, output: '' }), [])).toBe(r);
  });

  it('runs the program through `run`, records it, and formats the output for the model', async () => {
    const records: AnalysisRecord[] = [];
    const seen: string[] = [];
    const r = withAnalysisTool(runtime(), TABLES, async (code) => { seen.push(code); return { ok: true, output: '1948' }; }, records);
    expect(r.definitions.map((d: { name: string }) => d.name)).toEqual(['search_templates', 'run_analysis']);
    const out = await r.execute('run_analysis', { code: "df[df.Bezeichnung.str.contains('Kinder')].shape[0]" });
    expect(seen).toHaveLength(1);
    expect(out).toBe('Program output:\n1948');
    expect(records).toEqual([{ code: "df[df.Bezeichnung.str.contains('Kinder')].shape[0]", ok: true }]);
    expect(r.stats.byTool.run_analysis).toBe(1);
    expect(await r.execute('search_templates', {})).toBe('library:search_templates');
  });

  it('a failure — the program, or the browser not answering — is the tool answer, never a lost message', async () => {
    const records: AnalysisRecord[] = [];
    const failing = withAnalysisTool(runtime(), TABLES, async () => ({ ok: false, output: '', error: "KeyError: 'Menge'" }), records);
    expect(await failing.execute('run_analysis', { code: 'df.Menge.sum()' })).toMatch(/^The program failed: KeyError: 'Menge'[\s\S]*at most twice/);
    const silent = withAnalysisTool(runtime(), TABLES, async () => { throw new Error('The browser did not return the analysis in time'); }, records);
    expect(await silent.execute('run_analysis', { code: 'x' })).toMatch(/The program failed: The browser did not return/);
    expect(records.map(r => r.ok)).toEqual([false, false]);
    // The reason travels with the record: the card shows it under the program.
    expect(records[0].error).toBe("KeyError: 'Menge'");
    expect(records[1].error).toMatch(/^The browser did not return/);
    // No answer from the browser: the program cannot have run — counted as not started.
    expect(records.map(r => !!r.unstarted)).toEqual([false, true]);
  });

  it(`at most ${MAX_ANALYSES_PER_ANSWER} runs per answer; an empty program is refused`, async () => {
    const records: AnalysisRecord[] = [];
    const r = withAnalysisTool(runtime(), TABLES, async () => ({ ok: true, output: '1' }), records);
    expect(await r.execute('run_analysis', { code: '   ' })).toMatch(/needs a program/);
    for (let i = 0; i < MAX_ANALYSES_PER_ANSWER; i++) await r.execute('run_analysis', { code: `${i}` });
    expect(await r.execute('run_analysis', { code: 'more' })).toMatch(/limit for one answer/);
    expect(records).toHaveLength(MAX_ANALYSES_PER_ANSWER);
  });

  it('normalizers drop the malformed and bound the rest', () => {
    expect(normalizeAnalysisTables([{ key: 'a.csv', rows: 3.7, columns: ['x', 1] }, { key: '' }, null])).toEqual([{ key: 'a.csv', rows: 3, columns: ['x'] }]);
    expect(normalizeAnalysisTables('nope')).toEqual([]);
    expect(normalizeAnalyses([{ code: 'x', ok: 1 }, { ok: true }])).toEqual([{ code: 'x', ok: true }]);
    expect(normalizeAnalyses([{ code: 'y', ok: false, error: 'e'.repeat(500) }])).toEqual([{ code: 'y', ok: false, error: 'e'.repeat(300) }]);
    expect(formatAnalysisResult({ ok: true, output: '', truncated: true })).toMatch(/\(nothing printed\)\n\[output cut/);
  });

  it('the event contract: `analysis` is its own, non-terminal event', () => {
    expect(JOB_EVENTS).toContain('analysis');
    expect(jobEventFor({ analysis: { callId: 'c', code: 'x' } })).toBe('analysis');
    const client = readFileSync('lib/realtimeJob.ts', 'utf8');
    expect(client).toMatch(/\.on\('broadcast', \{ event: 'analysis' \}/);
    expect(client).toMatch(/channel\.httpSend\('analysis_result', payload\)/);
    expect(client).toMatch(/supabase\.channel\(`analysis:\$\{jobId\}`\)/);
  });
});

describe('SQEM-660 step C — the test of 2026-11-06', () => {
  const traceback = [
    'Traceback (most recent call last):',
    '  File "/lib/python314.zip/_pyodide/_base.py", line 619, in eval_code_async',
    '    await CodeRunner(',
    '    ...<10 lines>...',
    '  File "/lib/python314.zip/_pyodide/_base.py", line 420, in run_async',
    '    coroutine = eval(self.code, globals, locals)',
    '  File "<exec>", line 1, in <module>',
    "AttributeError: 'NoneType' object has no attribute 'copy'",
  ].join('\n');
  it('the card shows the END of a traceback — the line that names the reason', () => {
    const t = errorTail(traceback);
    expect(t.endsWith("AttributeError: 'NoneType' object has no attribute 'copy'")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t).not.toMatch(/^Traceback/);
    expect(errorTail('x'.repeat(500))).toBe('x'.repeat(300));
    expect(normalizeAnalyses([{ code: 'c', ok: false, error: traceback }])[0].error).toBe(errorTail(traceback));
  });
  it('`df` is the only table with rows — empty sheets do not count — and the tool says which', () => {
    const sheets = [{ key: 'W.xlsx / Items', rows: 12000, columns: ['a'] }, { key: 'W.xlsx / Info', rows: 0, columns: ['x'] }];
    expect(dfTableKey(sheets)).toBe('W.xlsx / Items');
    expect(analysisToolDefinition(sheets).description).toContain('`df` is tables["W.xlsx / Items"]');
    const two = [sheets[0], { ...sheets[1], rows: 5 }];
    expect(dfTableKey(two)).toBeNull();
    expect(analysisToolDefinition(two).description).toMatch(/There is no `df`/);
    expect(dfTableKey([{ key: 'leer.csv', rows: 0, columns: [] }])).toBe('leer.csv');
    // The frame picks by the same rule.
    const frame = readFileSync('public/analysis-sandbox.html', 'utf8');
    expect(frame).toMatch(/_t = \[v for v in tables\.values\(\) if len\(v\)\]/);
    expect(frame).toMatch(/df = next\(iter\(tables\.values\(\)\)\) if len\(tables\) == 1 else \(_t\[0\] if len\(_t\) == 1 else None\)/);
  });
  it('⛔ stored: count and success only — no program, no reason (2026-11-06)', () => {
    const recs: AnalysisRecord[] = [{ code: "d['Obergruppe'].eq('Kinder / Jugend')", ok: true }, { code: 'x', ok: false, error: 'ValueError: Kinder', unstarted: true }];
    expect(storedAnalyses(recs)).toEqual([{ ok: true }, { ok: false }]);
    expect(JSON.stringify(storedAnalyses(recs))).not.toMatch(/Kinder|code|error/);
    expect(normalizeStoredAnalyses([{ ok: true, code: 'leak' }, { ok: 'yes' }, null, { ok: false }])).toEqual([{ ok: true }, { ok: false }]);
    // Fits the CHECK of the migration with room to spare, even at the cap.
    const full = storedAnalyses(Array.from({ length: 9 }, () => ({ code: 'c', ok: false })));
    expect(full).toHaveLength(MAX_ANALYSES_PER_ANSWER);
    expect(JSON.stringify(full).length).toBeLessThan(1024);
    const sql = readFileSync('supabase/migrations/20261106200000_sqem660_analyses.sql', 'utf8');
    expect(sql).toMatch(/jsonb_array_length\(analyses\) <= 6/);
    expect(sql).toMatch(/octet_length\(analyses::text\) <= 1024/);
  });
  it('the monitor counts: runs, failed, not started — numbers only', () => {
    expect(analysisLogCounts([{ code: 'a', ok: true }, { code: 'b', ok: false }, { code: 'c', ok: false, unstarted: true }])).toEqual({ analyses: 3, analysesFailed: 2, analysesUnstarted: 1 });
  });
});

describe('SQEM-660 — tables from attachments (full rows, in the browser)', () => {
  it('a workbook gives every sheet in full — no text cap — and the meta carries no rows', async () => {
    const data = [[{ value: 'Item' }, { value: 'Description' }]];
    for (let r = 0; r < 12000; r++) data.push([{ value: `IT-${r}` }, { value: r % 7 ? 'Touring bike' : 'Kids bike 20 inch' }]);
    const bytes = await writeExcelFile([{ sheet: 'Items', data }, { sheet: 'Empty', data: [[{ value: 'x' }]] }]).toBuffer();
    const tables = await tablesFromFile(new Blob([new Uint8Array(bytes)]), 'stock.xlsx');
    expect(tables.map(t => [t.key, t.rows])).toEqual([['stock.xlsx / Items', 12000], ['stock.xlsx / Empty', 0]]);
    expect(tables[0].columns).toEqual(['Item', 'Description']);
    expect(tables[0].csv.split('\n')).toHaveLength(12001);
    expect(tables[0].csv.split('\n').filter(l => l.includes('Kids bike')).length).toBe(1715);
    expect(JSON.stringify(analysisTableMeta(tables))).not.toContain('IT-');
  });

  it('a csv as it is; one workbook sheet keeps the plain file name; duplicate keys get a suffix', async () => {
    const [t] = await tablesFromFile(new Blob(['a,"b, c"\n1,2\n3,4\n']), 'zahlen.csv');
    expect(t).toMatchObject({ key: 'zahlen.csv', rows: 2, columns: ['a', 'b, c'] });
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>h</t></is></c></row><row r="2"><c r="A2"><v>5</v></c></row></sheetData></worksheet>');
    const read = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    expect(await workbookTables(async p => (read.file(p) ? read.file(p)!.async('string') : null))).toEqual([{ sheet: 'S', csv: 'h\n5', rows: 1, columns: ['h'] }]);
    expect(uniqueTables([[t], [t]]).map(x => x.key)).toEqual(['zahlen.csv', 'zahlen.csv (2)']);
  });
});

describe('SQEM-660 — wiring', () => {
  const fn = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
  const chat = readFileSync('pages/Chat.tsx', 'utf8');
  it('chat-message: metadata in, tool on the base runtime, carried through hand-overs, shown with the result', () => {
    expect(fn).toMatch(/const analysisTables = normalizeAnalysisTables\(src\.analysisTables\);/);
    expect(fn).toMatch(/\.\.\.\(analysisTables\.length \? \{ analysisTables \} : \{\}\), \.\.\.\(connectorAnalysis \? \{ connectorAnalysis: true \} : \{\}\), \.\.\.\(images \? \{ images, officePictures \} : \{\}\) \} satisfies ContinuationRequest/);
    // SQEM-661 — the connector tables of this answer travel with the program (`pending`).
    expect(fn).toMatch(/if \(base && !routine\) base = withAnalysisTool\(base, analysisTables, \(code, pending\) => requestBrowserAnalysis\(jobId, code, cancel\.signal, pending\), analyses, connectorTables\);/);
    expect(fn).toMatch(/generatedFiles, analyses,/);
    expect(fn).toMatch(/\.\.\.\(analyses\.length \? \{ analyses \} : \{\}\),/);
    expect(fn).toMatch(/tools && analysisTables\.length \? ANALYSIS_INSTRUCTION : null/);
    expect(ANALYSIS_INSTRUCTION).toMatch(/not from the text excerpt/);
    // The same question gave 415 and 513 — the answer must name what it counted (2026-11-06).
    expect(ANALYSIS_INSTRUCTION).toMatch(/which rows you counted: the columns and values you filtered on/);
    expect(ANALYSIS_INSTRUCTION).toMatch(/say which reading you used/);
    expect(ANALYSIS_INSTRUCTION).not.toMatch(/'/);
  });
  it('⛔ the round trip listens BEFORE it sends, once, and stores nothing', () => {
    const rt = readFileSync('supabase/functions/_shared/analysisRoundTrip.ts', 'utf8');
    expect(rt).toMatch(/if \(status === 'SUBSCRIBED' && !sent\) \{\s*sent = true;[\s\S]*?broadcastJobResult\(jobId, \{ analysis: \{ callId, code, \.\.\.\(expect\.length \? \{ tables: expect \} : \{\}\) \} \}\)/);
    expect(rt).not.toMatch(/\.from\(/);
    expect(rt).toMatch(/if \(payload\?\.callId !== callId\) return;/);
  });
  it('Chat: only metadata goes to the server; the program runs on this chat\'s tables; the card shows what ran', () => {
    expect(chat).toMatch(/\.\.\.\(chatTables\.length \? \{ analysisTables: analysisTableMeta\(chatTables\) \} : \{\}\)/);
    // SQEM-661 — attachments and this answer's connector tables; an incomplete one is reported, not run on.
    expect(chat).toMatch(/if \(missing\.length\) return \{ ok: false, output: '', error: 'Connector data incomplete\.', unstarted: true, missingTables: missing \};/);
    expect(chat).toMatch(/return runAnalysis\(programWithDf\(code, dfKey, fromConnectors\.length > 0\), \[\.\.\.chatTables\.map\(t => \(\{ key: t\.key, csv: t\.csv \}\)\), \.\.\.fromConnectors\]\);/);
    // SQEM-662 — the bytes of a program's files stay here; the server hears name and size.
    expect(chat).toMatch(/const \{ files, \.\.\.rest \} = r as typeof r & \{ files\?: AnalysisFile\[\] \};/);
    expect(chat).toMatch(/return sendAnalysisResult\(jobId, \{ callId, \.\.\.rest, \.\.\.\(files\?\.length \? \{ files: files\.map\(f => \(\{ name: f\.name, size: f\.data\.byteLength \}\)\) \} : \{\}\) \}\);/);
    expect(chat).toMatch(/if \(t\.length\) preloadAnalysis\(\);/);
    expect(chat).toMatch(/<AnalysesCard analyses=\{msg\.analyses\} \/>/);
  });
  it('step C: stored with the answer, loaded with the history, carried by the shared mapping; the bubble says it computes', () => {
    expect(chat).toMatch(/generatedFiles, analyses: storedAnalyses\(analyses\) \}\)\.catch/);
    expect(chat).toMatch(/analyses: m\.analyses, \/\/ SQEM-660/);
    expect(chat).toMatch(/msg\.analysing \? txt\.chat_analysis_running\(\) : txt\.chat_still_working\(\)/);
    expect(chat).toMatch(/updateRunning\(run, \{ analysing: false \}\)/);
    expect(readFileSync('lib/api/chatSessions.ts', 'utf8')).toMatch(/extra\?\.analyses\?\.length \? \{ analyses: extra\.analyses as unknown as Json \}/);
    expect(readFileSync('lib/playbookRef.ts', 'utf8')).toMatch(/analyses: normalizeStoredAnalyses\(row\.analyses\)/);
    // SQEM-661 — only the last invocation logs, so the line counts the whole chain.
    expect(fn).toMatch(/\.\.\.\(analyses\.length \? analysisLogCounts\(analyses\) : \{\}\), \/\/ the whole chain/);
    expect(fn).not.toMatch(/analysesCarried/);
  });
  it('both languages', () => {
    for (const k of ['chatcard_analysis_ran', 'chatcard_analysis_where', 'chatcard_analysis_failed', 'chat_attach_truncated_table', 'chat_analysis_running', 'chatcard_analysis_not_kept'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
  });
});
