// SQEM-487 — measure which Sqemes tool Claude reaches for, with a given library prompt pasted in.
// SQEM-487 — which Sqemes tool does Claude reach for, with a given library prompt pasted in?
// Runs Claude Code headless (`claude -p`, your own login) against mock-mcp.mjs, a local MCP server
// with a FAKE library and the real tool descriptions, and judges each run by the calls it made.
//
//   node scripts/prompt-eval/run.mjs <variant> <prompt-file> [runs=3] [parallel=3] [CASE,CASE]
//
// Write the current prompt to a file first:
//   node -e "const s=require('fs').readFileSync('supabase/functions/_shared/libraryPrompt.ts','utf8');
//            require('fs').writeFileSync('/tmp/prompt.txt', s.match(/LIBRARY_SYSTEM_PROMPT = \`([\s\S]*?)\`;/)[1])"
// Each run
// costs one short Claude Code session on the account that is logged in; results land in
// scripts/prompt-eval/results/<variant>/ (git-ignored).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [variant, promptFile, runsArg = '3', parArg = '3', only] = process.argv.slice(2);
const RUNS = Number(runsArg), PAR = Number(parArg);
const HERE = new URL('.', import.meta.url).pathname;
const PROMPT = readFileSync(promptFile, 'utf8');

const CASES = [
  { id: 'P1', type: 'persona', want: 'recruiter', q: 'Schreib eine Absage an einen Bewerber für die Stelle als Backend-Entwickler.' },
  { id: 'P2', type: 'persona', want: 'recruiter', q: 'Ich brauche eine Stellenanzeige für eine Werkstudentin im Marketing.' },
  { id: 'P3', type: 'persona', want: 'sales_director', q: 'Bereite mich auf ein Preisgespräch mit einem Neukunden vor.' },
  { id: 'M1', type: 'two', want: ['Sales Director', 'Account Manager'], q: 'Erstelle ein Angebot über 50 Lizenzen für einen Kunden.' },
  { id: 'M2', type: 'two', want: ['Sales Director', 'Account Manager'], q: 'Ein Kunde will mehr Rabatt. Wie antworte ich ihm?' },
  { id: 'T1', type: 'playbook', want: 'release_notes', q: 'Schreib Release Notes für Version 2.3: Login ist schneller, der Export-Fehler ist behoben.' },
  { id: 'T2', type: 'playbook', want: 'meeting_notes', q: 'Fass dieses Meeting zusammen: Wir haben beschlossen, das Projekt bis Q2 zu verschieben; Anna klärt das Budget.' },
  { id: 'T3', type: 'playbook', want: 'brand_voice', q: 'Formulier diesen Satz in unserer Markenstimme: Wir sind ab Montag wieder erreichbar.' },
  { id: 'N1', type: 'none', q: 'Was ist die Hauptstadt von Australien?' },
  { id: 'N2', type: 'none', q: 'Erklär mir in zwei Sätzen, was ein Mutex ist.' },
].filter(c => !only || only.split(',').includes(c.id));

const OUT = join(HERE, 'results', variant);
mkdirSync(OUT, { recursive: true });
// ⛔ OUTSIDE the repository: run from inside it, Claude Code picks up this project's own agent
// instructions and settings, and the mock server was not reachable at all (seen 2026-10-19). An empty temp dir is the
// clean room the numbers in the module header were measured in.
const WORK = mkdtempSync(join(tmpdir(), 'sqemes-prompt-eval-'));

function runOne(c, n) {
  return new Promise((resolve) => {
    const log = join(OUT, `${c.id}-${n}.calls.jsonl`);
    if (existsSync(log)) rmSync(log);
    const cfg = join(OUT, `${c.id}-${n}.mcp.json`);
    writeFileSync(cfg, JSON.stringify({ mcpServers: { sqemes: { type: 'stdio', command: 'node', args: [join(HERE, 'mock-mcp.mjs')], env: { MOCK_LOG: log } } } }));
    const args = ['-p', c.q, '--append-system-prompt', PROMPT, '--mcp-config', cfg, '--strict-mcp-config',
      '--allowedTools', 'mcp__sqemes__search_templates,mcp__sqemes__get_template,mcp__sqemes__list_personas,mcp__sqemes__get_persona',
      '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,Agent,TodoWrite,NotebookEdit',
      '--setting-sources', 'project', '--model', 'sonnet', '--max-turns', '8', '--output-format', 'json', '--no-session-persistence'];
    const p = spawn('claude', args, { cwd: WORK, env: { ...process.env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', () => {});
    const timer = setTimeout(() => p.kill('SIGKILL'), 240_000);
    p.on('close', () => {
      clearTimeout(timer);
      let text = '';
      try { text = JSON.parse(out).result ?? ''; } catch { text = out.slice(0, 2000); }
      const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
      resolve(judge(c, n, calls, text));
    });
  });
}

function judge(c, n, calls, text) {
  const tools = calls.map(k => k.tool);
  const personaLoaded = calls.filter(k => k.tool === 'get_persona').map(k => k.args.name || k.args.id);
  const templates = calls.filter(k => k.tool === 'get_template').map(k => k.args.name || k.args.id);
  let ok;
  if (c.type === 'persona') ok = personaLoaded.includes(c.want);
  if (c.type === 'two') ok = c.want.every(w => text.includes(w)) && templates.length === 0;
  if (c.type === 'playbook') ok = templates.includes(c.want);
  if (c.type === 'none') ok = tools.length === 0;
  const r = { variant, id: c.id, type: c.type, n, ok, first: tools[0] ?? '-', tools: tools.join('>'), persona: personaLoaded.join(','), templates: templates.join(','), text: text.slice(0, 400) };
  writeFileSync(join(OUT, `${c.id}-${n}.json`), JSON.stringify(r, null, 2));
  console.log(`${variant} ${c.id}#${n} ${ok ? 'OK ' : 'NO '} first=${r.first} tools=${r.tools || '-'}`);
  return r;
}

const jobs = CASES.flatMap(c => Array.from({ length: RUNS }, (_, i) => [c, i + 1]));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < jobs.length) { const [c, n] = jobs[next++]; results.push(await runOne(c, n)); }
}));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
const by = {};
for (const r of results) { by[r.id] ??= []; by[r.id].push(r.ok); }
console.log('\nSUMMARY', variant);
for (const c of CASES) console.log(c.id, c.type.padEnd(8), (by[c.id] || []).filter(Boolean).length + '/' + (by[c.id] || []).length);
const ok = results.filter(r => r.ok).length;
console.log('TOTAL', ok + '/' + results.length);
